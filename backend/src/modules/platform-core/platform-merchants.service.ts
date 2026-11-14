import { Optional } from '@nestjs/common';
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import { deliveryProfile } from './delivery-profile';
import { PlatformMerchantProvisioning } from './platform-merchant-provisioning';
import { Prisma } from '@prisma/client';
import { coproductionOwnerNet } from '../coproduction/coproduction';
import { platformMerchant } from './platform-merchant-lookup';
import { PlatformPaymentLookup } from '../unified-platform/payments/platform-payment-lookup';
import { IntegrationFinanceService } from '../integrations/integration-finance.service';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PlatformPaymentsService } from '../unified-platform/payments/platform-payments.service';
import { acquirerCostFloor } from '../financial-policy/acquirer-fees';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { CreatePlatformPaymentDto } from '../unified-platform/payments/platform-payment.dto';
import { platformFeeSchedule } from '../financial-policy/platform-fee-schedule';
import {
  getPlatformTaxaEffective,
  domCashbackReais,
} from '../platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../platform-taxas/platform-taxas.keys';
import type { PlatformContext } from './platform-context.service';

@Injectable()
export class PlatformMerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PlatformPaymentsService,
    private readonly finance: PlatformFinanceService,
    @Optional()
    private readonly reconciler?: ReconcilePendingTransactionsUseCase,
  ) {}
  private namespace(context: PlatformContext) {
    return `platform:${context.id}`;
  }

  async provision(
    context: PlatformContext,
    externalMerchantId: string,
    body: { cnpj: string; legalName: string },
  ) {
    let namespace = this.namespace(context);
    try {
      namespace = (await this.resolve(context, externalMerchantId))
        .integrationKey;
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- integrationKey is internal and must not leak
    const { integrationKey, ...result } =
      await new PlatformMerchantProvisioning(this.prisma).provision(
        namespace,
        externalMerchantId,
        body,
      );
    return result;
  }

  async resolve(context: PlatformContext, externalMerchantId: string) {
    return platformMerchant(this.prisma, context, externalMerchantId);
  }

  createPayment(
    context: PlatformContext,
    externalMerchantId: string,
    input: CreatePlatformPaymentDto,
  ) {
    return this.payments.createForMerchant(context, externalMerchantId, input);
  }
  async summary(context: PlatformContext, externalMerchantId: string) {
    const merchant = await this.resolve(context, externalMerchantId);
    const { feePolicy, ...processing } = await new IntegrationFinanceService(
      this.prisma,
    ).summary(merchant.integrationKey, externalMerchantId, true);
    return {
      ...(await this.finance.summary({
        ...context,
        ownerUserId: merchant.userId,
      })),
      ...processing,
      feePolicy: {
        fixedCents: feePolicy.fixedCents,
        rate: new Prisma.Decimal(feePolicy.percentBasisPoints)
          .div(10000)
          .toNumber(),
      },
      walletScope: 'merchant-user',
    };
  }
  async paymentAttempt(
    context: PlatformContext,
    externalMerchantId: string,
    key: string,
  ) {
    const result = await this.payments.readByKey(
      context,
      externalMerchantId,
      key,
    );
    return this.payment(context, externalMerchantId, result.transactionId);
  }
  async payment(
    context: PlatformContext,
    externalMerchantId: string,
    paymentId: string,
  ) {
    const merchant = await this.resolve(context, externalMerchantId);
    const payment = await new PlatformPaymentLookup(this.prisma).find(
      context,
      paymentId,
      merchant.userId,
    );
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    if (
      context.delivery &&
      this.reconciler &&
      ['DRAFT', 'PENDING'].includes(payment.status) &&
      payment.externalPaymentId
    ) {
      const { token } = await deliveryProfile(this.prisma, context);
      const remote = await this.reconciler.reconcilePayment(
        payment.externalPaymentId,
        merchant.userId,
        token,
      );
      payment.status = remote.status as typeof payment.status;
    }
    return {
      transactionId: payment.id,
      paymentId: payment.externalPaymentId,
      status: payment.status,
      amountCents: this.finance.cents(payment.amount),
      coproductionCents: this.coproductionCents(payment),
      pixContent: payment.pixContent,
      qrCode: payment.pixQrCode,
      pixExpire: payment.pixExpire,
    };
  }
  /** Partners' frozen share of the net amount; zero without coproduction or before the net is known. */
  private coproductionCents(payment: {
    financialSnapshot: Prisma.JsonValue | null;
    netAmount: Prisma.Decimal | null;
  }) {
    if (payment.netAmount == null) return 0;
    return payment.netAmount
      .sub(coproductionOwnerNet(payment.financialSnapshot, payment.netAmount))
      .mul(100)
      .round()
      .toNumber();
  }
  /** Merchant-scoped ledger rows (same visibility and platform-tag rules as the owner report), in cents. */
  async transactions(
    context: PlatformContext,
    externalMerchantId: string,
    query: {
      page?: number;
      limit?: number;
      startDate?: string;
      endDate?: string;
      status?: string;
      description?: string;
    },
  ) {
    const merchant = await this.resolve(context, externalMerchantId);
    // Legacy clients send the literal ALL to mean "no filter".
    const all = (value?: string) =>
      !value || value.toUpperCase() === 'ALL' ? undefined : value;
    const result = await this.finance.transactions(
      { ...context, ownerUserId: merchant.userId },
      {
        page: query.page,
        limit: query.limit,
        startDate: all(query.startDate),
        endDate: all(query.endDate),
        status: all(query.status)?.toUpperCase(),
        search: all(query.description),
      },
    );
    const serviceFeeCents = this.finance.cents(
      getPlatformTaxaEffective(
        context.tag,
        'TAXA_SERVICO',
        PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
      ),
    );
    return {
      ...result,
      data: result.data.map((row) => {
        const commission = /\[AFFILIATE_COMMISSION\]/i.test(
          row.description ?? '',
        );
        const feeCents = commission ? 0 : serviceFeeCents;
        return {
          ...row,
          transactionFeeCents: feeCents,
          sellerNetCents: row.netAmountCents - feeCents,
        };
      }),
    };
  }
  /** Fees the seller really pays: withdrawal policy, per-transaction fees and the per-modality schedule. */
  async fees(context: PlatformContext, externalMerchantId: string) {
    await this.resolve(context, externalMerchantId);
    const schedule = await platformFeeSchedule(this.prisma, context.tag);
    return {
      unit: 'cents',
      withdrawal: this.finance.withdrawalPolicy(context.tag),
      transaction: {
        serviceFeeCents: this.finance.cents(
          getPlatformTaxaEffective(
            context.tag,
            'TAXA_SERVICO',
            PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
          ),
        ),
        fixedFeeCents: this.finance.cents(
          getPlatformTaxaEffective(
            context.tag,
            'TAXA_FIXA_TRANSACAO',
            PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
          ),
        ),
        cashbackCents: this.finance.cents(domCashbackReais()),
      },
      ...schedule,
    };
  }
  /** Ledger entry (pending sale or affiliate commission) attributed to this merchant's account. */
  async importEntry(
    context: PlatformContext,
    externalMerchantId: string,
    body: Record<string, unknown>,
  ) {
    if (context.tag !== 'EBOOK')
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: 'ledger.import',
      });
    const merchant = await this.resolve(context, externalMerchantId);
    return this.finance.importEntry(context, body, merchant.userId);
  }
  async withdrawals(
    context: PlatformContext,
    externalMerchantId: string,
    page = 1,
    limit = 20,
  ) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequestException('Paginação inválida');
    const merchant = await this.resolve(context, externalMerchantId);
    const result = await new IntegrationFinanceService(
      this.prisma,
    ).listWithdrawals(merchant.integrationKey, externalMerchantId, page, limit);
    return {
      unit: 'cents',
      data: result.items.map(({ netAmountCents, ...row }) => ({
        ...row,
        requestId: this.clientRequestId(context, merchant.id, row.requestId),
        amountCents: netAmountCents,
      })),
      meta: {
        page,
        limit,
        total: result.meta.totalItems,
        totalPages: result.meta.totalPages,
      },
    };
  }
  async withdrawal(
    context: PlatformContext,
    externalMerchantId: string,
    withdrawalId: string,
  ) {
    const merchant = await this.resolve(context, externalMerchantId);
    const { netAmountCents, ...row } = await new IntegrationFinanceService(
      this.prisma,
    ).getWithdrawal(merchant.integrationKey, externalMerchantId, withdrawalId);
    return {
      unit: 'cents',
      ...row,
      requestId: this.clientRequestId(context, merchant.id, row.requestId),
      amountCents: netAmountCents,
    };
  }
  /** Custo global das adquirentes ativas (ONLINE): piso das taxas cobradas de qualquer lojista. */
  async acquirerCosts(context: PlatformContext, externalMerchantId: string) {
    await this.resolve(context, externalMerchantId);
    return { costs: await acquirerCostFloor(this.prisma) };
  }
  async quote(
    context: PlatformContext,
    externalMerchantId: string,
    amountCents: number,
  ) {
    await this.resolve(context, externalMerchantId);
    return new IntegrationFinanceService(this.prisma).quote(
      amountCents,
      context.tag,
    );
  }
  async reconcile(
    context: PlatformContext,
    externalMerchantId: string,
    paymentIds: string[],
    dryRun: boolean,
  ) {
    if (
      !Array.isArray(paymentIds) ||
      paymentIds.length > 500 ||
      paymentIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      typeof dryRun !== 'boolean'
    )
      throw new BadRequestException('Contrato inválido');
    const merchant = await this.resolve(context, externalMerchantId);
    return new IntegrationFinanceService(this.prisma).reconcilePayments(
      merchant.integrationKey,
      externalMerchantId,
      paymentIds,
      dryRun,
    );
  }
  private clientRequestId(
    context: PlatformContext,
    merchantId: string,
    key: string | null,
  ) {
    const prefix = `platform:${context.id}:${merchantId}:`;
    return key?.startsWith(prefix) ? key.slice(prefix.length) : key;
  }
  async withdraw(
    context: PlatformContext,
    externalMerchantId: string,
    body: { amountCents: number; pixKey: string; idempotencyKey: string },
  ) {
    const merchant = await this.resolve(context, externalMerchantId);
    const result = await this.finance.requestWithdrawal(
      context,
      body,
      merchant,
    );
    const row = await this.prisma.withdrawRequest.findUniqueOrThrow({
      where: { id: result.id },
    });
    return {
      ...result,
      pixKey: row.pixKey,
      rejectionReason: row.rejectionReason,
      requestId: body.idempotencyKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
