import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Acquirer,
  BillingContractStatus,
  BillingIntervalType,
  BillingQuantityChangeStatus,
  PaymentMethod,
  Prisma,
  TransactionStatus,
} from '@prisma/client';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  PAYMENT_GATEWAY_DOM,
  type IPaymentGateway,
  type StoredPaymentChargeOutput,
} from '../../../core/services/payment-gateway.interface';
import { getModuleDomToken } from '../../../modules/module.registry';
import { CreateBillingContractDto } from '../../dtos/billing/create-billing-contract.dto';
import { ChangeBillingQuantityDto } from '../../dtos/billing/change-billing-quantity.dto';
import {
  advanceBillingPeriod,
  calculateProration,
  retreatBillingPeriod,
} from '../../../core/billing/proration-calculator';
import { buildBillingTransactionDescription } from '../../helpers/billing-transaction-description.helper';

const MUTABLE_CHANGE_STATUSES: BillingQuantityChangeStatus[] = [
  BillingQuantityChangeStatus.PENDING_PAYMENT,
  BillingQuantityChangeStatus.PENDING_RECURRENCE_UPDATE,
  BillingQuantityChangeStatus.SCHEDULED,
];

type BillingChangeWithRelations = Prisma.BillingQuantityChangeGetPayload<{
  include: { contract: true; transaction: true };
}>;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_DOM)
    private readonly gateway: IPaymentGateway,
  ) {}

  async createContract(dto: CreateBillingContractDto) {
    const periodStart = new Date(dto.currentPeriodStart);
    const periodEnd = new Date(dto.currentPeriodEnd);
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw new BadRequestException(
        'currentPeriodEnd deve ser posterior a currentPeriodStart',
      );
    }
    const minimumQuantity = dto.minimumQuantity ?? 1;
    if (dto.quantity < minimumQuantity) {
      throw new BadRequestException(
        'quantity não pode ser menor que minimumQuantity',
      );
    }

    const existing = await this.prisma.billingContract.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: dto.resourceType,
          resourceId: dto.resourceId,
        },
      },
    });
    if (existing) {
      if (
        existing.userId === dto.userId &&
        existing.externalSubscriptionId === dto.externalSubscriptionId
      ) {
        return this.serializeContract(existing);
      }
      throw new ConflictException(
        'Já existe contrato para este recurso faturável',
      );
    }

    const domToken = await this.resolveDomToken(dto.userId);
    const snapshot = await this.gateway.getSubscriptionBillingSnapshot(
      domToken,
      dto.externalSubscriptionId,
    );
    if (snapshot.status.toLowerCase() !== 'active') {
      throw new ConflictException(
        `Assinatura DOM não está ativa: ${snapshot.status}`,
      );
    }

    const baseAmount = new Prisma.Decimal(dto.baseAmount);
    const unitAmount = new Prisma.Decimal(dto.unitAmount);
    const expectedRecurringAmount = baseAmount
      .plus(unitAmount.times(dto.quantity))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const externalRecurringAmount = new Prisma.Decimal(
      snapshot.recurringAmount,
    ).toDecimalPlaces(2);
    if (!expectedRecurringAmount.equals(externalRecurringAmount)) {
      throw new ConflictException(
        `Preço do contrato (${expectedRecurringAmount.toFixed(2)}) diverge da assinatura DOM (${externalRecurringAmount.toFixed(2)})`,
      );
    }

    const interval = this.normalizeInterval(
      snapshot.frequencyType,
      snapshot.frequency,
    );
    const contract = await this.prisma.billingContract.create({
      data: {
        userId: dto.userId,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        priceKey: dto.priceKey ?? null,
        pricingVersion: dto.pricingVersion ?? null,
        baseAmount,
        unitAmount,
        quantity: dto.quantity,
        minimumQuantity,
        intervalType: interval.type,
        intervalCount: interval.count,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        externalPlanId: snapshot.planId,
        externalSubscriptionId: snapshot.id,
        description: dto.description ?? null,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        acquirer: Acquirer.DOM,
      },
    });
    return this.serializeContract(contract);
  }

  /**
   * Registra uma tentativa antes de chamar a adquirente. Assim recusas, timeout
   * e respostas sem identificador externo continuam auditáveis na Simintpay.
   * Dados brutos do cartão nunca entram neste registro.
   */
  async startWorkspacePaymentAttempt(input: {
    userId: string;
    amount: number;
    description: string;
    customer: { name: string; email: string; document: string; phone: string };
  }) {
    return this.prisma.transaction.create({
      data: {
        userId: input.userId,
        amount: new Prisma.Decimal(input.amount),
        status: TransactionStatus.PENDING,
        paymentMethod: PaymentMethod.CREDIT_CARD,
        description: input.description,
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        customerDocument: input.customer.document,
        customerPhone: input.customer.phone,
      },
    });
  }

  async resolveWorkspacePaymentAttempt(input: {
    transactionId: string;
    externalSubscriptionId: string;
    status: TransactionStatus;
  }) {
    return this.prisma.transaction.update({
      where: { id: input.transactionId },
      data: {
        status: input.status,
        externalPaymentId: input.externalSubscriptionId,
        updatedAt: new Date(),
      },
    });
  }

  /** Associa a tentativa pendente à assinatura antes do primeiro webhook DOM. */
  async attachWorkspacePaymentAttempt(
    transactionId: string,
    externalSubscriptionId: string,
  ) {
    return this.prisma.transaction.update({
      where: { id: transactionId },
      data: { externalPaymentId: externalSubscriptionId, updatedAt: new Date() },
    });
  }

  async failWorkspacePaymentAttempt(transactionId: string) {
    return this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        previousStatus: TransactionStatus.PENDING,
        status: TransactionStatus.FAILED,
        updatedAt: new Date(),
      },
    });
  }

  /** DOM webhook signing key. Caller must verify signature before processing. */
  async getDomWebhookToken(subscriptionId: string): Promise<string | null> {
    const contract = await this.prisma.billingContract.findUnique({
      where: { externalSubscriptionId: subscriptionId },
      select: { userId: true },
    });
    if (contract) return this.resolveDomToken(contract.userId);

    // O postback da criação chega antes do contrato existir. A tentativa
    // pendente já possui o dono da assinatura e permite validar esse JWT com
    // o mesmo token DOM usado na criação.
    const attempt = await this.prisma.transaction.findFirst({
      where: {
        externalPaymentId: subscriptionId,
        description: { startsWith: 'Teron workspace (' },
      },
      select: { userId: true },
      orderBy: { createdAt: 'desc' },
    });
    return attempt ? this.resolveDomToken(attempt.userId) : null;
  }

  /** Applies one normalized DOM event. Transaction id makes repeated events harmless. */
  async applyWorkspacePaymentEvent(input: {
    subscriptionId: string;
    eventKey: string;
    event: 'PAID' | 'FAILED' | 'CANCELLED';
    paymentId?: string | null;
    amount?: number | null;
  }): Promise<boolean> {
    const contract = await this.prisma.billingContract.findUnique({
      where: { externalSubscriptionId: input.subscriptionId },
    });
    if (!contract) return false;

    const existing = await this.prisma.billingContractEvent.findUnique({ where: { eventKey: input.eventKey } });
    if (existing) return true;
    const now = new Date();
    const amount = new Prisma.Decimal(input.amount ?? contract.baseAmount.plus(contract.unitAmount.times(contract.quantity)));
    const transactionDescription = buildBillingTransactionDescription(
      contract.description,
      contract.metadata,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.billingContractEvent.create({
        data: { contractId: contract.id, eventKey: input.eventKey, type: input.event, payload: { paymentId: input.paymentId ?? null } },
      });
      if (input.paymentId) {
        await tx.transaction.upsert({
          where: { domPaymentId: input.paymentId },
          update: {
            status: input.event === 'PAID' ? TransactionStatus.COMPLETED : TransactionStatus.FAILED,
            description: transactionDescription,
          },
          create: {
            userId: contract.userId, amount, netAmount: amount,
            status: input.event === 'PAID' ? TransactionStatus.COMPLETED : TransactionStatus.FAILED,
            paymentMethod: PaymentMethod.CREDIT_CARD,
            description: transactionDescription,
            domPaymentId: input.paymentId, externalPaymentId: input.paymentId, acquirer: Acquirer.DOM,
          },
        });
      }
      if (input.event === 'PAID') {
        const start = now > contract.currentPeriodEnd ? now : contract.currentPeriodStart;
        const end = advanceBillingPeriod(start, contract.intervalType, contract.intervalCount);
        await tx.billingContract.update({ where: { id: contract.id }, data: {
          status: BillingContractStatus.ACTIVE, currentPeriodStart: start, currentPeriodEnd: end,
          pastDueAt: null, graceEndsAt: null, suspendedAt: null, accessEndsAt: null,
        } });
      } else if (input.event === 'FAILED') {
        await tx.billingContract.update({ where: { id: contract.id }, data: {
          status: BillingContractStatus.PAST_DUE, pastDueAt: now,
          graceEndsAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
        } });
      } else {
        await tx.billingContract.update({ where: { id: contract.id }, data: {
          status: BillingContractStatus.CANCELLED, accessEndsAt: contract.currentPeriodEnd,
        } });
      }
    });
    return true;
  }

  async reconcileDunning(): Promise<void> {
    const now = new Date();
    const overdue = await this.prisma.billingContract.findMany({
      where: { status: BillingContractStatus.PAST_DUE, graceEndsAt: { lte: now } },
      select: { id: true },
    });
    for (const contract of overdue) {
      await this.prisma.$transaction([
        this.prisma.billingContract.update({ where: { id: contract.id }, data: { status: BillingContractStatus.SUSPENDED, suspendedAt: now } }),
        this.prisma.billingContractEvent.create({ data: {
          contractId: contract.id, eventKey: `dunning:suspended:${contract.id}`, type: 'SUSPENDED', payload: {},
        } }),
      ]);
    }
    await this.deliverTeronEvents();
  }

  private async deliverTeronEvents(): Promise<void> {
    const url = process.env.TERON_BILLING_WEBHOOK_URL;
    const secret = process.env.TERON_BILLING_WEBHOOK_SECRET;
    if (!url || !secret) return;
    const events = await this.prisma.billingContractEvent.findMany({
      where: { deliveredAt: null }, include: { contract: true }, take: 50, orderBy: { createdAt: 'asc' },
    });
    for (const event of events) {
      const c = event.contract;
      const meta = (c.metadata ?? {}) as { teronAccountId?: string; workspaceId?: string };
      if (c.resourceType !== 'WORKSPACE' || !meta.workspaceId || !meta.teronAccountId) continue;
      const status = c.status === BillingContractStatus.PAST_DUE ? 'past_due'
        : c.status === BillingContractStatus.SUSPENDED ? 'paused'
          : c.status === BillingContractStatus.CANCELLED && c.accessEndsAt && c.accessEndsAt <= new Date() ? 'expired' : 'active';
      const body = JSON.stringify({ eventId: event.id, workspaceId: meta.workspaceId, accountId: meta.teronAccountId,
        providerSubscriptionId: c.externalSubscriptionId, contractId: c.id, status,
        periodStart: c.currentPeriodStart.toISOString(), periodEnd: c.currentPeriodEnd.toISOString(),
        willCancelAt: c.accessEndsAt?.toISOString() ?? null, quantity: c.quantity });
      try {
        const signature = createHmac('sha256', secret).update(body).digest('hex');
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-simintpay-signature': signature }, body });
        if (!response.ok) throw new Error(`Teron respondeu ${response.status}`);
        await this.prisma.billingContractEvent.update({ where: { id: event.id }, data: { deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      } catch (error) {
        await this.prisma.billingContractEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 }, lastError: this.errorMessage(error) } });
      }
    }
  }

  async findByResource(resourceType: string, resourceId: string) {
    const contract = await this.prisma.billingContract.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: resourceType.trim().toUpperCase(),
          resourceId,
        },
      },
    });
    if (!contract)
      throw new NotFoundException('Contrato de cobrança não encontrado');
    return this.serializeContract(contract);
  }

  async getContract(id: string) {
    const contract = await this.prisma.billingContract.findUnique({
      where: { id },
    });
    if (!contract)
      throw new NotFoundException('Contrato de cobrança não encontrado');
    return this.serializeContract(contract);
  }

  async cancelContract(id: string) {
    const contract = await this.prisma.billingContract.findUnique({
      where: { id },
    });
    if (!contract)
      throw new NotFoundException('Contrato de cobrança não encontrado');
    if (contract.status === BillingContractStatus.CANCELLED) {
      return this.serializeContract(contract);
    }

    const domToken = await this.resolveDomToken(contract.userId);
    await this.gateway.cancelSubscription(domToken, contract.externalSubscriptionId);

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.billingContract.update({
        where: { id: contract.id },
        data: {
          status: BillingContractStatus.CANCELLED,
          accessEndsAt: contract.currentPeriodEnd,
        },
      });
      await tx.billingContractEvent.create({
        data: {
          contractId: contract.id,
          // A contract may be cancelled again after reactivation. Each state
          // transition needs a distinct outbox event, while repeats in the
          // same state return before this transaction.
          eventKey: `cancel:${contract.id}:${randomUUID()}`,
          type: 'CANCELLED',
          payload: { source: 'workspace' },
        },
      });
      return updated;
    });
    await this.deliverTeronEvents();
    return this.serializeContract(cancelled);
  }

  async reactivateContract(id: string) {
    const contract = await this.prisma.billingContract.findUnique({
      where: { id },
    });
    if (!contract)
      throw new NotFoundException('Contrato de cobrança não encontrado');
    if (contract.status === BillingContractStatus.ACTIVE) {
      return this.serializeContract(contract);
    }

    const domToken = await this.resolveDomToken(contract.userId);
    await this.gateway.reactivateSubscription(domToken, contract.externalSubscriptionId);

    const reactivated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.billingContract.update({
        where: { id: contract.id },
        data: {
          status: BillingContractStatus.ACTIVE,
          accessEndsAt: null,
        },
      });
      await tx.billingContractEvent.create({
        data: {
          contractId: contract.id,
          eventKey: `reactivate:${contract.id}:${randomUUID()}`,
          type: 'REACTIVATED',
          payload: { source: 'workspace' },
        },
      });
      return updated;
    });
    await this.deliverTeronEvents();
    return this.serializeContract(reactivated);
  }

  async getChange(contractId: string, changeId: string) {
    const change = await this.prisma.billingQuantityChange.findFirst({
      where: { id: changeId, contractId },
      include: { transaction: true, contract: true },
    });
    if (!change)
      throw new NotFoundException('Mudança de quantidade não encontrada');
    return this.serializeChange(change);
  }

  async requestQuantityChange(
    contractId: string,
    idempotencyKey: string,
    dto: ChangeBillingQuantityDto,
  ) {
    const requestHash = this.hashRequest({
      targetQuantity: dto.targetQuantity,
      expectedVersion: dto.expectedVersion,
      effectiveAt: dto.effectiveAt ?? null,
    });
    const duplicate = await this.prisma.billingQuantityChange.findUnique({
      where: { contractId_idempotencyKey: { contractId, idempotencyKey } },
      include: { transaction: true, contract: true },
    });
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key reutilizada com outro payload',
        );
      }
      return this.serializeChange(duplicate);
    }

    let contract = await this.prisma.billingContract.findUnique({
      where: { id: contractId },
    });
    if (!contract)
      throw new NotFoundException('Contrato de cobrança não encontrado');
    if (contract.status !== BillingContractStatus.ACTIVE) {
      throw new ConflictException('Contrato de cobrança não está ativo');
    }
    if (contract.version !== dto.expectedVersion) {
      throw new ConflictException({
        code: 'BILLING_VERSION_CONFLICT',
        message: 'Versão do contrato está desatualizada',
        currentVersion: contract.version,
        currentQuantity: contract.quantity,
      });
    }
    if (dto.targetQuantity < contract.minimumQuantity) {
      throw new BadRequestException(
        `targetQuantity deve ser maior ou igual a ${contract.minimumQuantity}`,
      );
    }

    const otherChange = await this.prisma.billingQuantityChange.findFirst({
      where: { contractId, status: { in: MUTABLE_CHANGE_STATUSES } },
      select: { id: true, status: true },
    });
    if (otherChange) {
      throw new ConflictException({
        code: 'BILLING_CHANGE_IN_PROGRESS',
        message: 'Já existe uma mudança de quantidade em andamento',
        changeId: otherChange.id,
        status: otherChange.status,
      });
    }

    const effectiveAt = dto.effectiveAt
      ? new Date(dto.effectiveAt)
      : new Date();
    if (effectiveAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException('effectiveAt não pode estar no futuro');
    }
    contract = await this.refreshPeriodIfNeeded(contract, effectiveAt);
    const calculation = calculateProration({
      baseAmount: contract.baseAmount,
      unitAmount: contract.unitAmount,
      previousQuantity: contract.quantity,
      targetQuantity: dto.targetQuantity,
      periodStart: contract.currentPeriodStart,
      periodEnd: contract.currentPeriodEnd,
      effectiveAt,
    });

    const isReduction = dto.targetQuantity < contract.quantity;
    const isNoop = dto.targetQuantity === contract.quantity;
    const startsAtOrAfterNextPeriod =
      effectiveAt.getTime() >= contract.currentPeriodEnd.getTime();
    const isScheduled = !isNoop && (isReduction || startsAtOrAfterNextPeriod);
    const initialStatus = isNoop
      ? BillingQuantityChangeStatus.APPLIED
      : isScheduled
        ? BillingQuantityChangeStatus.SCHEDULED
        : BillingQuantityChangeStatus.PENDING_PAYMENT;
    const prorationAmount = isScheduled
      ? new Prisma.Decimal(0)
      : calculation.prorationAmount;

    let change;
    try {
      change = await this.prisma.$transaction(async (tx) => {
        const created = await tx.billingQuantityChange.create({
          data: {
            contractId,
            idempotencyKey,
            requestHash,
            expectedVersion: dto.expectedVersion,
            previousQuantity: contract.quantity,
            targetQuantity: dto.targetQuantity,
            effectiveAt,
            scheduledFor: isScheduled ? contract.currentPeriodEnd : null,
            periodStart: contract.currentPeriodStart,
            periodEnd: contract.currentPeriodEnd,
            remainingRatio: isScheduled
              ? new Prisma.Decimal(0)
              : calculation.remainingRatio,
            previousRecurringAmount: calculation.previousRecurringAmount,
            nextRecurringAmount: calculation.nextRecurringAmount,
            prorationAmount,
            status: initialStatus,
            calculationSnapshot: {
              baseAmount: contract.baseAmount.toFixed(2),
              unitAmount: contract.unitAmount.toFixed(2),
              durationMs:
                contract.currentPeriodEnd.getTime() -
                contract.currentPeriodStart.getTime(),
              effectiveAt: effectiveAt.toISOString(),
              reductionPolicy: 'SCHEDULE_WITHOUT_CREDIT',
            },
          },
        });
        if (!isNoop) {
          const updated = await tx.billingContract.updateMany({
            where: { id: contractId, version: dto.expectedVersion },
            data: {
              pendingQuantity: dto.targetQuantity,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1)
            throw new ConflictException('Contrato alterado concorrentemente');
        }
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.billingQuantityChange.findUnique({
          where: { contractId_idempotencyKey: { contractId, idempotencyKey } },
          include: { transaction: true, contract: true },
        });
        if (raced && raced.requestHash === requestHash)
          return this.serializeChange(raced);
        if (raced)
          throw new ConflictException(
            'Idempotency-Key reutilizada com outro payload',
          );
      }
      throw error;
    }

    if (isNoop) {
      return this.serializeChange(await this.loadChangeWithContract(change.id));
    }
    if (isScheduled) {
      return contract.currentPeriodEnd.getTime() <= Date.now()
        ? this.processChange(change.id)
        : this.serializeChange(await this.loadChangeWithContract(change.id));
    }
    return this.processChange(change.id);
  }

  async reconcileChange(contractId: string, changeId: string) {
    const exists = await this.prisma.billingQuantityChange.findFirst({
      where: { id: changeId, contractId },
      select: { id: true },
    });
    if (!exists)
      throw new NotFoundException('Mudança de quantidade não encontrada');
    return this.processChange(changeId);
  }

  async reconcilePendingChanges(limit = 20): Promise<void> {
    const changes = await this.prisma.billingQuantityChange.findMany({
      where: {
        OR: [
          { status: BillingQuantityChangeStatus.PENDING_PAYMENT },
          { status: BillingQuantityChangeStatus.PENDING_RECURRENCE_UPDATE },
          {
            status: BillingQuantityChangeStatus.SCHEDULED,
            scheduledFor: { lte: new Date() },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const change of changes) {
      try {
        await this.processChange(change.id);
      } catch (error) {
        this.logger.error(
          `Falha ao reconciliar billing change ${change.id}: ${String(error)}`,
        );
      }
    }
  }

  private async processChange(changeId: string) {
    const leaseCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const processingStartedAt = new Date();
    const claimed = await this.prisma.billingQuantityChange.updateMany({
      where: {
        id: changeId,
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: leaseCutoff } },
        ],
      },
      data: { processingStartedAt },
    });
    if (claimed.count !== 1) {
      const inProgress =
        await this.prisma.billingQuantityChange.findUniqueOrThrow({
          where: { id: changeId },
          include: { transaction: true, contract: true },
        });
      return this.serializeChange(inProgress);
    }

    try {
      return await this.processClaimedChange(changeId);
    } finally {
      await this.prisma.billingQuantityChange.updateMany({
        where: { id: changeId, processingStartedAt },
        data: { processingStartedAt: null },
      });
    }
  }

  private async processClaimedChange(changeId: string) {
    let change = await this.prisma.billingQuantityChange.findUnique({
      where: { id: changeId },
      include: { contract: true, transaction: true },
    });
    if (!change)
      throw new NotFoundException('Mudança de quantidade não encontrada');
    if (
      change.status === BillingQuantityChangeStatus.APPLIED ||
      change.status === BillingQuantityChangeStatus.FAILED ||
      change.status === BillingQuantityChangeStatus.COMPENSATION_REQUIRED
    ) {
      return this.serializeChange(change);
    }

    const domToken = await this.resolveDomToken(change.contract.userId);
    const isScheduled = change.status === BillingQuantityChangeStatus.SCHEDULED;
    if (isScheduled) {
      if (!change.scheduledFor || change.scheduledFor.getTime() > Date.now()) {
        return this.serializeChange(change);
      }
      change = await this.prisma.billingQuantityChange.update({
        where: { id: change.id },
        data: { status: BillingQuantityChangeStatus.PENDING_RECURRENCE_UPDATE },
        include: { contract: true, transaction: true },
      });
    }

    if (change.status === BillingQuantityChangeStatus.PENDING_PAYMENT) {
      const payment = await this.ensureProrationPayment(change, domToken);
      if (!payment) {
        const pending =
          await this.prisma.billingQuantityChange.findUniqueOrThrow({
            where: { id: change.id },
            include: { transaction: true, contract: true },
          });
        return this.serializeChange(pending);
      }
      if (this.isFailureStatus(payment.status)) {
        const failedChange = change;
        const failed = await this.prisma.$transaction(async (tx) => {
          await tx.billingContract.updateMany({
            where: {
              id: failedChange.contractId,
              version: failedChange.expectedVersion + 1,
              pendingQuantity: failedChange.targetQuantity,
            },
            data: { pendingQuantity: null },
          });
          return tx.billingQuantityChange.update({
            where: { id: failedChange.id },
            data: {
              status: BillingQuantityChangeStatus.FAILED,
              failureCode: 'PRORATION_PAYMENT_FAILED',
              failureMessage: `Cobrança não aprovada: ${payment.status}`,
            },
            include: { transaction: true, contract: true },
          });
        });
        return this.serializeChange(failed);
      }
      if (!this.isPaidStatus(payment.status)) {
        const pending =
          await this.prisma.billingQuantityChange.findUniqueOrThrow({
            where: { id: change.id },
            include: { transaction: true, contract: true },
          });
        return this.serializeChange(pending);
      }
      change = await this.prisma.billingQuantityChange.update({
        where: { id: change.id },
        data: {
          status: BillingQuantityChangeStatus.PENDING_RECURRENCE_UPDATE,
          failureCode: null,
          failureMessage: null,
        },
        include: { contract: true, transaction: true },
      });
    }

    if (
      change.status === BillingQuantityChangeStatus.PENDING_RECURRENCE_UPDATE
    ) {
      return this.applyRecurringAmount(change.id, domToken);
    }
    return this.serializeChange(change);
  }

  private async ensureProrationPayment(
    change: Awaited<ReturnType<typeof this.loadChangeWithContract>>,
    domToken: string,
  ): Promise<StoredPaymentChargeOutput | null> {
    try {
      let payment: StoredPaymentChargeOutput;
      if (change.externalPaymentId) {
        const detail: unknown = await this.gateway.getDomTransactionDetail(
          domToken,
          change.externalPaymentId,
        );
        const detailObject = this.toRecord(detail);
        const order = this.toRecord(detailObject?.order) ?? detailObject;
        const status =
          this.toScalarString(order?.type ?? order?.status) ?? 'pending';
        const amount =
          this.toFiniteNumber(order?.total) ?? Number(change.prorationAmount);
        const netAmount = this.toFiniteNumber(order?.total_liquid);
        payment = {
          id: change.externalPaymentId,
          status,
          amount,
          netAmount,
        };
      } else {
        const appUrl = (
          process.env.URL_APP ?? 'https://simpay-back.simintermediacoes.com'
        ).replace(/\/+$/, '');
        payment = await this.gateway.chargeSubscriptionPaymentMethod(domToken, {
          subscriptionId: change.contract.externalSubscriptionId,
          amount: Number(change.prorationAmount),
          description:
            `Ajuste proporcional ${change.contract.description ?? change.contract.resourceType}`.slice(
              0,
              80,
            ),
          codExternal: change.id,
          idempotencyKey: change.id,
          postbackUrl: `${appUrl}/webhook/master`,
        });
      }

      const tx = await this.upsertTransaction(change, payment);
      await this.prisma.billingQuantityChange.update({
        where: { id: change.id },
        data: {
          externalPaymentId: payment.id,
          transactionId: tx.id,
          failureCode: null,
          failureMessage: null,
        },
      });
      return payment;
    } catch (error) {
      await this.prisma.billingQuantityChange.update({
        where: { id: change.id },
        data: {
          failureCode: 'PAYMENT_GATEWAY_UNAVAILABLE',
          failureMessage: this.errorMessage(error),
        },
      });
      return null;
    }
  }

  private async applyRecurringAmount(changeId: string, domToken: string) {
    let change = await this.loadChangeWithContract(changeId);
    let planId = change.externalPlanId;
    if (!planId) {
      try {
        const plan = await this.gateway.createPlan(domToken, {
          price: Number(change.nextRecurringAmount),
          description: (
            change.contract.description ??
            `Contrato ${change.contract.resourceType}`
          ).slice(0, 80),
          frequency_type: change.contract.intervalType,
          frequency: change.contract.intervalCount,
          repetitions: 0,
          retry_days: 3,
        });
        planId = plan.id;
        change = await this.prisma.billingQuantityChange.update({
          where: { id: change.id },
          data: {
            externalPlanId: planId,
            failureCode: null,
            failureMessage: null,
          },
          include: { contract: true, transaction: true },
        });
      } catch (error) {
        const pending = await this.prisma.billingQuantityChange.update({
          where: { id: change.id },
          data: {
            failureCode: 'PLAN_CREATION_FAILED',
            failureMessage: this.errorMessage(error),
          },
          include: { transaction: true, contract: true },
        });
        return this.serializeChange(pending);
      }
    }

    let migration;
    try {
      migration = await this.gateway.changeSubscriptionPlan(domToken, {
        subscriptionId: change.contract.externalSubscriptionId,
        planId,
      });
    } catch (error) {
      const compensation = await this.prisma.billingQuantityChange.update({
        where: { id: change.id },
        data: {
          status: BillingQuantityChangeStatus.COMPENSATION_REQUIRED,
          failureCode: 'SUBSCRIPTION_MIGRATION_UNCERTAIN',
          failureMessage: this.errorMessage(error),
        },
        include: { transaction: true, contract: true },
      });
      return this.serializeChange(compensation);
    }

    const scheduled = change.scheduledFor != null;
    const requiredVersion = change.expectedVersion + 1;
    let nextPeriodStart = scheduled
      ? change.contract.currentPeriodEnd
      : change.contract.currentPeriodStart;
    let nextPeriodEnd = scheduled
      ? advanceBillingPeriod(
          change.contract.currentPeriodEnd,
          change.contract.intervalType,
          change.contract.intervalCount,
        )
      : change.contract.currentPeriodEnd;
    while (scheduled && nextPeriodEnd.getTime() <= Date.now()) {
      nextPeriodStart = nextPeriodEnd;
      nextPeriodEnd = advanceBillingPeriod(
        nextPeriodEnd,
        change.contract.intervalType,
        change.contract.intervalCount,
      );
    }

    try {
      const applied = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.billingContract.updateMany({
          where: { id: change.contractId, version: requiredVersion },
          data: {
            quantity: change.targetQuantity,
            pendingQuantity: null,
            externalPlanId: planId,
            externalSubscriptionId: migration.subscriptionId,
            currentPeriodStart: nextPeriodStart,
            currentPeriodEnd: nextPeriodEnd,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1)
          throw new ConflictException('Contrato alterado concorrentemente');

        await tx.subscription.updateMany({
          where: { domSubscriptionId: change.contract.externalSubscriptionId },
          data: { domSubscriptionId: migration.subscriptionId },
        });
        await tx.subscriptionLinkOrder.updateMany({
          where: { domSubscriptionId: change.contract.externalSubscriptionId },
          data: { domSubscriptionId: migration.subscriptionId },
        });
        return tx.billingQuantityChange.update({
          where: { id: change.id },
          data: {
            status: BillingQuantityChangeStatus.APPLIED,
            externalPlanId: planId,
            externalSubscriptionId: migration.subscriptionId,
            failureCode: null,
            failureMessage: null,
          },
          include: { transaction: true, contract: true },
        });
      });
      return this.serializeChange(applied);
    } catch (error) {
      const compensation = await this.prisma.billingQuantityChange.update({
        where: { id: change.id },
        data: {
          status: BillingQuantityChangeStatus.COMPENSATION_REQUIRED,
          externalSubscriptionId: migration.subscriptionId,
          failureCode: 'LOCAL_STATE_UPDATE_FAILED',
          failureMessage: this.errorMessage(error),
        },
        include: { transaction: true, contract: true },
      });
      return this.serializeChange(compensation);
    }
  }

  private loadChangeWithContract(changeId: string) {
    return this.prisma.billingQuantityChange.findUniqueOrThrow({
      where: { id: changeId },
      include: { contract: true, transaction: true },
    });
  }

  private async upsertTransaction(
    change: Awaited<ReturnType<typeof this.loadChangeWithContract>>,
    payment: StoredPaymentChargeOutput,
  ) {
    const status = this.mapTransactionStatus(payment.status);
    const amount = new Prisma.Decimal(payment.amount).toDecimalPlaces(2);
    const netAmount =
      payment.netAmount == null
        ? null
        : new Prisma.Decimal(payment.netAmount).toDecimalPlaces(2);
    const totalFee =
      netAmount == null ? new Prisma.Decimal(0) : amount.minus(netAmount);
    const data = {
      userId: change.contract.userId,
      amount,
      netAmount,
      status,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      installments: 1,
      totalFee,
      domFee: totalFee,
      platformFee: new Prisma.Decimal(0),
      description: `Ajuste proporcional [BILLING_CHANGE:${change.id}]`,
      acquirer: Acquirer.DOM,
      externalPaymentId: payment.id,
    };
    return this.prisma.transaction.upsert({
      where: { domPaymentId: payment.id },
      update: data,
      create: { ...data, domPaymentId: payment.id },
    });
  }

  private async resolveDomToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        domToken: true,
        clientStatus: true,
        platform: { select: { tag: true } },
      },
    });
    if (!user)
      throw new NotFoundException('Usuário dono do contrato não encontrado');
    const token = user.clientStatus
      ? process.env.DOM_TOKEN
      : (user.domToken ??
        getModuleDomToken(user.platform?.tag) ??
        process.env.DOM_TOKEN);
    if (!token)
      throw new BadRequestException(
        'Token DOM não configurado para o contrato',
      );
    return token;
  }

  private async refreshPeriodIfNeeded<
    T extends {
      id: string;
      userId: string;
      externalSubscriptionId: string;
      baseAmount: Prisma.Decimal;
      unitAmount: Prisma.Decimal;
      quantity: number;
      intervalType: BillingIntervalType;
      intervalCount: number;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    },
  >(contract: T, effectiveAt: Date): Promise<T> {
    if (effectiveAt.getTime() < contract.currentPeriodEnd.getTime())
      return contract;

    const domToken = await this.resolveDomToken(contract.userId);
    const snapshot = await this.gateway.getSubscriptionBillingSnapshot(
      domToken,
      contract.externalSubscriptionId,
    );
    if (snapshot.status.toLowerCase() !== 'active') {
      throw new ConflictException(
        `Assinatura DOM não está ativa: ${snapshot.status}`,
      );
    }
    const localAmount = contract.baseAmount
      .plus(contract.unitAmount.times(contract.quantity))
      .toDecimalPlaces(2);
    const externalAmount = new Prisma.Decimal(
      snapshot.recurringAmount,
    ).toDecimalPlaces(2);
    if (!localAmount.equals(externalAmount)) {
      throw new ConflictException({
        code: 'BILLING_EXTERNAL_DRIFT',
        message: 'Valor recorrente local diverge da assinatura DOM',
        localAmount: localAmount.toFixed(2),
        externalAmount: externalAmount.toFixed(2),
      });
    }

    const externalInterval = this.normalizeInterval(
      snapshot.frequencyType,
      snapshot.frequency,
    );
    if (
      externalInterval.type !== contract.intervalType ||
      externalInterval.count !== contract.intervalCount
    ) {
      throw new ConflictException({
        code: 'BILLING_EXTERNAL_DRIFT',
        message: 'Intervalo recorrente local diverge da assinatura DOM',
      });
    }

    let periodStart = contract.currentPeriodStart;
    let periodEnd = contract.currentPeriodEnd;
    const externalPeriodEnd = snapshot.nextInvoiceAt
      ? new Date(snapshot.nextInvoiceAt)
      : null;
    const externalPeriodStart =
      externalPeriodEnd && Number.isFinite(externalPeriodEnd.getTime())
        ? retreatBillingPeriod(
            externalPeriodEnd,
            contract.intervalType,
            contract.intervalCount,
          )
        : null;
    if (
      externalPeriodStart &&
      externalPeriodEnd &&
      externalPeriodStart.getTime() <= effectiveAt.getTime() &&
      effectiveAt.getTime() < externalPeriodEnd.getTime()
    ) {
      periodStart = externalPeriodStart;
      periodEnd = externalPeriodEnd;
    } else {
      while (periodEnd.getTime() <= effectiveAt.getTime()) {
        periodStart = periodEnd;
        periodEnd = advanceBillingPeriod(
          periodEnd,
          contract.intervalType,
          contract.intervalCount,
        );
      }
    }
    await this.prisma.billingContract.update({
      where: { id: contract.id },
      data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    });
    return {
      ...contract,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    };
  }

  private normalizeInterval(
    frequencyType: string,
    frequency: number,
  ): { type: BillingIntervalType; count: number } {
    const count = Math.max(1, Math.round(frequency || 1));
    switch (frequencyType.toUpperCase()) {
      case 'DAY':
        return { type: BillingIntervalType.DAY, count };
      case 'WEEK':
        return { type: BillingIntervalType.WEEK, count };
      case 'QUARTER':
        return { type: BillingIntervalType.MONTH, count: count * 3 };
      case 'SEMESTER':
        return { type: BillingIntervalType.MONTH, count: count * 6 };
      case 'YEAR':
        return { type: BillingIntervalType.YEAR, count };
      case 'MONTH':
        return { type: BillingIntervalType.MONTH, count };
      default:
        throw new BadRequestException(
          `Frequência DOM não suportada: ${frequencyType}`,
        );
    }
  }

  private mapTransactionStatus(status: string): TransactionStatus {
    const normalized = status.toLowerCase();
    if (this.isPaidStatus(normalized)) return TransactionStatus.COMPLETED;
    if (this.isFailureStatus(normalized)) return TransactionStatus.FAILED;
    if (normalized === 'refunded') return TransactionStatus.REFUNDED;
    return TransactionStatus.PENDING;
  }

  private isPaidStatus(status: string): boolean {
    return ['paid', 'approved', 'completed'].includes(status.toLowerCase());
  }

  private isFailureStatus(status: string): boolean {
    return [
      'failed',
      'not_authorized',
      'rejected',
      'expired',
      'cancelled',
      'canceled',
    ].includes(status.toLowerCase());
  }

  private hashRequest(payload: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message.slice(0, 1000);
    return String(error).slice(0, 1000);
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toScalarString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    return null;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private serializeContract(contract: {
    id: string;
    userId: string;
    resourceType: string;
    resourceId: string;
    priceKey: string | null;
    pricingVersion: number | null;
    currency: string;
    baseAmount: Prisma.Decimal;
    unitAmount: Prisma.Decimal;
    quantity: number;
    pendingQuantity: number | null;
    minimumQuantity: number;
    intervalType: BillingIntervalType;
    intervalCount: number;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    status: BillingContractStatus;
    version: number;
    externalPlanId: string | null;
    externalSubscriptionId: string;
    description: string | null;
  }) {
    return {
      ...contract,
      baseAmount: contract.baseAmount.toFixed(2),
      unitAmount: contract.unitAmount.toFixed(2),
      recurringAmount: contract.baseAmount
        .plus(contract.unitAmount.times(contract.quantity))
        .toDecimalPlaces(2)
        .toFixed(2),
      currentPeriodStart: contract.currentPeriodStart.toISOString(),
      currentPeriodEnd: contract.currentPeriodEnd.toISOString(),
    };
  }

  private serializeChange(change: BillingChangeWithRelations) {
    return {
      id: change.id,
      contractId: change.contractId,
      status: change.status,
      contractVersion: change.contract?.version ?? null,
      previousQuantity: change.previousQuantity,
      targetQuantity: change.targetQuantity,
      effectiveQuantity:
        change.status === BillingQuantityChangeStatus.APPLIED
          ? change.targetQuantity
          : (change.contract?.quantity ?? change.previousQuantity),
      effectiveAt: change.effectiveAt.toISOString(),
      scheduledFor: change.scheduledFor?.toISOString() ?? null,
      periodStart: change.periodStart.toISOString(),
      periodEnd: change.periodEnd.toISOString(),
      remainingRatio: change.remainingRatio.toFixed(10),
      previousRecurringAmount: change.previousRecurringAmount.toFixed(2),
      nextRecurringAmount: change.nextRecurringAmount.toFixed(2),
      prorationAmount: change.prorationAmount.toFixed(2),
      externalPaymentId: change.externalPaymentId,
      externalPlanId: change.externalPlanId,
      externalSubscriptionId: change.externalSubscriptionId,
      failureCode: change.failureCode,
      failureMessage: change.failureMessage,
      transaction: change.transaction
        ? { id: change.transaction.id, status: change.transaction.status }
        : null,
      createdAt: change.createdAt.toISOString(),
      updatedAt: change.updatedAt.toISOString(),
    };
  }
}
