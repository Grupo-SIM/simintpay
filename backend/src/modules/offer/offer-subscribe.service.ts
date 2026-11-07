import { findOfferByCodeOrId } from './find-offer-by-code-or-id';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type Acquirer,
  PaymentMethod,
  Prisma,
  TransactionStatus,
  type BillingContract,
  type Charge,
  type Offer,
} from '@prisma/client';
import { platformGatewayToken } from '../../application/helpers/explicit-platform.helper';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../core/repositories/user.repository.interface';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import { BillingCycleService } from '../billing-core/billing-cycle.service';
import {
  CARD_TOKEN_SOURCE,
  firstChargeOutcome,
  parseExpiry,
  type CardTokenSource,
  type RawCard,
} from '../billing-core/card-token-source';
import {
  markChargeSettled,
  onChargeSettled,
} from '../billing-core/charge-settlement';
import { resolveDomPublicKey } from '../billing-core/dom-public-key';
import { ExternalRefService } from '../billing-core/external-ref.service';
import {
  decryptPlatformSecret,
  encryptPlatformSecret,
} from '../platform-integrations/platform-secrets';
import { StoredCardVaultService } from '../billing-core/stored-card-vault.service';
import { coproductionKeyFor } from './offer-coproduction';
import {
  captureCoproduction,
  withCoproduction,
} from '../coproduction/coproduction.service';
import { paymentTracking } from '../platform-core/payment-tracking';
import { persistLinkCharge } from '../platform-core/link-settlement';
import { transactionPlatformTagData } from '../platform-core/transaction-platform';
import { classifyChargeOutcome } from '../unified-platform/payments/dom-rejection';
import type {
  OfferCardCustomerDto,
  OfferSubscribeDto,
} from './offer-subscribe.dto';
import { offerGatewayLinkInput } from './offer-gateway-link';
import { priceOfferCharge } from './offer-pricing';

export type OfferSubscribeResult = {
  contractId: string;
  /** Null while a trial has no charge yet (the first one is issued at the end of the trial). */
  chargeId: string | null;
  transactionId: string | null;
  /** True when the buyer already had a contract for this offer; nothing new was created or charged. */
  existing: boolean;
  contractStatus: string;
  chargeStatus: string;
  renewalMode: string;
  amount: number;
  nextChargeAt: string | null;
  /** AUTO_CHARGE: whether a reusable card token is now stored for the next cycles. */
  cardSaved: boolean;
  /** MANUAL_PAY: PIX of the first cycle (also returned when repeating a still-pending subscribe). */
  pix: {
    pixContent: string | null;
    qrCode: string | null;
    pixExpire: string | null;
  } | null;
  redirectUrl: string | null;
};

type PendingCard = {
  brand: string | null;
  last4: string;
  expMonth: number;
  expYear: number;
  /** customer-token: DOM customer the token is bound to. */
  customerId?: string;
  /** customer-token: browser-made token, encrypted, until it lands in the vault. */
  encryptedToken?: string;
};

export type OfferCardCustomerResult = { customerId: string; publicKey: string };

const resourceIdOf = (offerId: string, email: string) => `${offerId}:${email}`;

/**
 * Public checkout of a recurring Offer (AUTO_CHARGE card / MANUAL_PAY PIX). Creates the
 * buyer's BillingContract and charges the first cycle through the same fee/quote/Transaction
 * path as the one-off checkout. Later cycles belong to BillingCycleService.runDue.
 * Raw card data lives only in the request and the single acquirer call; never persisted or logged.
 */
@Injectable()
export class OfferSubscribeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferSubscribeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly gateways: PaymentGatewayResolver,
    private readonly refs: ExternalRefService,
    private readonly billing: BillingCycleService,
    private readonly vault: StoredCardVaultService,
    @Inject(CARD_TOKEN_SOURCE) private readonly tokenSource: CardTokenSource,
  ) {}

  private off?: () => void;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * A first PIX/card payment settled by webhook ends here: when a Charge with a contract turns
   * PAID, the card pending in the contract is captured. The listener runs inside the settling
   * transaction, so the work is deferred past its commit (like OfferFulfillmentService).
   */
  onModuleInit() {
    this.off = onChargeSettled((event) => {
      if (event.kind === 'PAID') this.scheduleCapture(event.transactionId);
    });
  }

  onModuleDestroy() {
    this.off?.();
    for (const t of this.timers) clearTimeout(t);
  }

  scheduleCapture(transactionId: string, delayMs = 500) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.captureForTransaction(transactionId).catch((error: unknown) =>
        this.logger.error(
          `Captura do cartão (tx=${transactionId}): ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** Captures the card of the contract behind a PAID charge. Idempotent. */
  async captureForTransaction(transactionId: string): Promise<boolean> {
    const charge = await this.prisma.charge.findUnique({
      where: { transactionId },
      select: { contractId: true, status: true },
    });
    if (!charge?.contractId || charge.status !== 'PAID') return false;
    return this.completeCardCapture(charge.contractId);
  }

  /**
   * customer-token step 1: creates/gets the buyer's customer at the offer's acquirer account
   * and returns what the browser needs to tokenize the card into that customer's wallet.
   * Nothing is persisted; the private token never leaves the server.
   */
  async cardCustomer(
    code: string,
    input: OfferCardCustomerDto,
    now = new Date(),
  ): Promise<OfferCardCustomerResult> {
    const offer = await findOfferByCodeOrId(this.prisma, code);
    if (
      !offer ||
      !offer.isActive ||
      (offer.expiresAt && offer.expiresAt <= now)
    )
      throw new NotFoundException('Oferta não encontrada');
    if (offer.renewalMode !== 'AUTO_CHARGE')
      throw new BadRequestException(
        'Somente ofertas com cobrança automática tokenizam o cartão',
      );
    if (this.tokenSource.kind !== 'customer-token')
      throw new BadRequestException(
        'Tokenização no navegador indisponível para esta configuração',
      );
    const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
    const acquirer = this.gateways.acquirerForSlug(platformTag);
    const gateway = this.gateways.byAcquirer(acquirer);
    if (!gateway.getOrCreateCustomer)
      throw new BadRequestException(
        'O adquirente desta oferta não tokeniza cartão por cliente',
      );
    const domToken = platformGatewayToken(platformTag, process.env.DOM_TOKEN);
    if (!domToken)
      throw new BadRequestException('Token do gateway não configurado');
    const publicKey = resolveDomPublicKey(platformTag);
    const document = input.customerDocument.replace(/\D/g, '');
    const customerId = await gateway.getOrCreateCustomer(domToken, {
      name: input.customerName,
      email: input.customerEmail.trim().toLowerCase(),
      document,
      phone: (input.customerPhone ?? '').replace(/\D/g, ''),
      documentType: document.length === 14 ? 'CNPJ' : 'CPF',
    });
    return { customerId, publicKey };
  }

  async subscribe(
    code: string,
    input: OfferSubscribeDto,
    now = new Date(),
  ): Promise<OfferSubscribeResult> {
    const offer = await findOfferByCodeOrId(this.prisma, code);
    if (
      !offer ||
      !offer.isActive ||
      (offer.expiresAt && offer.expiresAt <= now)
    )
      throw new NotFoundException('Oferta não encontrada');
    if (offer.maxUses !== null && offer.usedCount >= offer.maxUses)
      throw new BadRequestException('Limite de usos da oferta atingido');
    if (
      offer.renewalMode !== 'AUTO_CHARGE' &&
      offer.renewalMode !== 'MANUAL_PAY'
    )
      throw new BadRequestException(
        'Esta oferta não é recorrente; use a cobrança avulsa',
      );

    const auto = offer.renewalMode === 'AUTO_CHARGE';
    const trial = (offer.trialDays ?? 0) > 0;
    if (trial && !(auto && this.tokenSource.kind === 'customer-token'))
      throw new BadRequestException(
        'Ofertas com período de teste exigem cobrança automática com tokenização no navegador',
      );
    if ((input.paymentMethod as string) === 'boleto')
      throw new BadRequestException(
        'Ofertas recorrentes não aceitam boleto; use cartão (cobrança automática) ou PIX (pagamento manual)',
      );
    const method: PaymentMethod = auto ? 'CREDIT_CARD' : 'PIX';
    if (input.paymentMethod !== (auto ? 'credit_card' : 'pix'))
      throw new BadRequestException(
        auto
          ? 'Assinaturas com cobrança automática exigem cartão de crédito'
          : 'Assinaturas com pagamento manual começam por PIX',
      );
    if (!offer.acceptedMethods.includes(method))
      throw new BadRequestException(
        'Esta oferta não aceita o meio de pagamento da recorrência',
      );

    const email = input.customerEmail.trim().toLowerCase();
    const existing = await this.existingContract(offer, email);
    if (existing) return this.describe(offer, existing, true);

    const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
    const acquirer = this.gateways.acquirerForSlug(platformTag);
    const capabilities = this.gateways.capabilitiesFor(acquirer);
    if (!capabilities.methods.has(method))
      throw new BadRequestException(
        'O adquirente desta oferta não suporta o meio de pagamento da recorrência',
      );
    if (auto && !capabilities.chargeStoredCard)
      throw new BadRequestException(
        'O adquirente desta oferta não suporta cobrança automática no cartão',
      );
    const gateway = this.gateways.byAcquirer(acquirer);
    const domToken = platformGatewayToken(platformTag, process.env.DOM_TOKEN);
    if (!domToken)
      throw new BadRequestException('Token do gateway não configurado');

    let pendingCard: PendingCard | null = null;
    if (auto) {
      const card = input.card;
      if (!card)
        throw new BadRequestException('Dados do cartão são obrigatórios');
      pendingCard = this.cardMetadata(card);
      if (
        this.tokenSource.kind === 'card-token' &&
        !gateway.createReusableCardToken
      )
        throw new BadRequestException(
          'O adquirente desta oferta não emite token de cartão reutilizável',
        );
    }

    if (trial) {
      return this.startTrial(offer, input, {
        email,
        acquirer,
        pendingCard: pendingCard!,
        now,
      });
    }

    const pricing = await priceOfferCharge(
      this.prisma,
      this.users,
      offer,
      method,
      1,
    );
    const amountCents = Math.round(pricing.totalAmount * 100);

    const document = input.customerDocument.replace(/\D/g, '');
    const phone = (input.customerPhone ?? '').replace(/\D/g, '');
    const documentType =
      input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF');
    const key = coproductionKeyFor(offer);
    const coproduction = await captureCoproduction(
      this.prisma,
      key.product,
      key.productId,
      offer.ownerUserId,
      offer.platformTag ? pricing.platformTag : undefined,
    );
    const baseDescription = offer.description
      ? `${offer.name} | ${offer.description}`
      : offer.name;
    const txId = randomUUID();
    const snapshot = {
      financialSnapshot: withCoproduction(
        pricing.financialSnapshot,
        coproduction,
      ),
      userId: offer.ownerUserId,
      amount: new Prisma.Decimal(pricing.totalAmount),
      netAmount: new Prisma.Decimal(pricing.netAmount),
      paymentMethod: method,
      totalFee: new Prisma.Decimal(pricing.totalFee),
      domFee: new Prisma.Decimal(pricing.domFee),
      platformFee: new Prisma.Decimal(pricing.platformFee),
      description:
        pricing.platformTag !== 'GLOBAL'
          ? `${baseDescription} [TENANT:${pricing.platformTag}]`
          : baseDescription,
      ...transactionPlatformTagData(pricing.platformTag),
      customerName: input.customerName,
      customerEmail: email,
      customerDocument: document,
      customerPhone: phone || null,
      tracking: paymentTracking(input.tracking),
      installments: 1,
    };

    // ── Reserva de uso + contrato + Charge do primeiro ciclo + rascunho FINAL_NET ──
    const claimed = await this.prisma.offer.updateMany({
      where: {
        id: offer.id,
        isActive: true,
        ...(offer.maxUses !== null ? { usedCount: { lt: offer.maxUses } } : {}),
      },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count !== 1)
      throw new BadRequestException('Limite de usos da oferta atingido');

    let contract: BillingContract;
    let charge: Charge;
    try {
      ({ contract, charge } = await this.billing.subscribe({
        offerId: offer.id,
        customerName: input.customerName,
        customerEmail: email,
        customerDocument: document,
        now,
      }));
    } catch (error) {
      await this.releaseUse(offer.id);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Corrida: outra requisição criou o contrato deste comprador primeiro.
        const winner = await this.existingContract(offer, email);
        if (winner) return this.describe(offer, winner, true);
      }
      throw error;
    }
    try {
      await this.prisma.$transaction(async (p) => {
        await p.wallet.upsert({
          where: { userId: offer.ownerUserId },
          update: {},
          create: { userId: offer.ownerUserId, balance: 0 },
        });
        await p.transaction.create({
          data: {
            ...snapshot,
            id: txId,
            status: 'DRAFT',
            settlementBasis: 'FINAL_NET',
          },
        });
        await p.charge.update({
          where: { id: charge.id },
          data: {
            transactionId: txId,
            method,
            amountCents,
            attempts: 1,
            snapshot: {
              baseAmountCents: offer.amountCents,
              installments: 1,
              totalFee: pricing.totalFee,
              domFee: pricing.domFee,
              platformFee: pricing.platformFee,
              netAmount: pricing.netAmount,
              acquirer,
              firstCycle: true,
              financial: (snapshot.financialSnapshot ??
                null) as Prisma.InputJsonValue,
            },
          },
        });
        await p.billingContract.update({
          where: { id: contract.id },
          data: {
            acquirer,
            description: offer.name.slice(0, 120),
            ...(pendingCard
              ? {
                  metadata: { pendingCard } as unknown as Prisma.InputJsonValue,
                }
              : {}),
          },
        });
      });
    } catch (error) {
      await this.discard(offer.id, contract.id, charge.id, txId);
      throw error;
    }

    const description = `${snapshot.description} [LINK_CHARGE:${txId}]`;
    const customer = {
      name: input.customerName,
      email,
      document,
      phone,
      documentType,
    } as const;

    // ── PIX (MANUAL_PAY): primeiro ciclo; os próximos viram CHARGE_DUE ──
    if (!auto) {
      const domLinkId = await this.gatewayLinkId(
        offer,
        acquirer,
        domToken,
        gateway,
      );
      let pix;
      try {
        pix = await gateway.chargePixForLink(domToken, {
          domLinkId,
          amount: pricing.totalAmount,
          description,
          customerName: input.customerName,
          customerEmail: email,
          customerDocument: document,
          customerPhone: phone,
          documentType,
          codExternal: txId,
        });
      } catch (error) {
        if (classifyChargeOutcome(error).safeToRetry)
          await this.discard(offer.id, contract.id, charge.id, txId);
        throw error;
      }
      await this.prisma.$transaction((p) =>
        persistLinkCharge(
          p,
          {
            ...snapshot,
            domPaymentId: pix.id,
            pixContent: pix.pixContent ?? null,
            pixExpire: pix.pixExpire ? new Date(pix.pixExpire) : null,
          } as never,
          TransactionStatus.PENDING,
          txId,
        ),
      );
      const fresh = await this.describe(offer, contract, false);
      if (fresh.pix) fresh.pix.qrCode = pix.qrCode ?? null;
      return fresh;
    }

    // ── Cartão (AUTO_CHARGE): primeiro ciclo + token reutilizável ──
    const card = input.card!;
    const rawCard: RawCard = {
      token: card.token ?? '',
      number: card.number ?? '',
      cvv: card.cvv ?? '',
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      holder_name: card.holder_name,
      holder_document: card.holder_document ?? '',
      brand: card.brand,
      bin: card.bin,
    };
    const domLinkId =
      this.tokenSource.kind !== 'subscription'
        ? await this.gatewayLinkId(offer, acquirer, domToken, gateway)
        : '';
    let first;
    try {
      first = await this.tokenSource.chargeFirstCycle({
        gateway,
        domToken,
        acquirerCode: acquirer,
        offer: {
          id: offer.id,
          name: offer.name,
          intervalType: offer.intervalType,
          intervalCount: offer.intervalCount,
        },
        contractId: contract.id,
        amount: pricing.totalAmount,
        description,
        domLinkId,
        customer,
        card: rawCard,
        customerId: card.customerId,
      });
    } catch (error) {
      if (classifyChargeOutcome(error).safeToRetry)
        await this.discard(offer.id, contract.id, charge.id, txId);
      throw error;
    }

    const outcome = firstChargeOutcome(first.status);
    const nextStatus =
      outcome === 'PAID'
        ? TransactionStatus.COMPLETED
        : outcome === 'FAILED'
          ? TransactionStatus.FAILED
          : TransactionStatus.PENDING;
    await this.prisma.$transaction(async (p) => {
      await persistLinkCharge(
        p,
        {
          ...snapshot,
          domPaymentId: first.paymentId,
          pixContent: null,
          pixExpire: null,
        } as never,
        nextStatus,
        txId,
      );
      // Avança o contrato (ativa ou cancela) na mesma transação da liquidação.
      await markChargeSettled(p, txId, nextStatus, now);
    });
    if (outcome === 'FAILED') {
      await this.prisma.billingContract.update({
        where: { id: contract.id },
        data: { metadata: Prisma.DbNull },
      });
      await this.releaseUse(offer.id);
      throw new BadRequestException({
        message: 'Pagamento recusado',
        contractId: contract.id,
        chargeId: charge.id,
      });
    }
    if (outcome === 'PAID') {
      await this.storeCard(contract, email, acquirer, first.token, {
        gateway,
        domToken,
      });
    }
    return this.describe(offer, contract, false);
  }

  /**
   * Stores the reusable token of a paid subscription whose card could not be captured at
   * checkout (pending first charge settled later by webhook, or a capture that failed).
   * Idempotent: returns false when there is nothing to do.
   */
  async completeCardCapture(contractId: string): Promise<boolean> {
    const contract = await this.prisma.billingContract.findUnique({
      where: { id: contractId },
    });
    const pending = (contract?.metadata as { pendingCard?: PendingCard } | null)
      ?.pendingCard;
    if (!contract || !pending || contract.status !== 'ACTIVE') return false;
    const offer = await this.prisma.offer.findUniqueOrThrow({
      where: { id: contract.offerId! },
    });
    const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
    const acquirer = this.gateways.acquirerForSlug(platformTag);
    if (pending.encryptedToken)
      return this.persistCard(
        contract,
        contract.customerEmail ?? '',
        acquirer,
        decryptPlatformSecret(pending.encryptedToken),
      );
    const domToken = platformGatewayToken(platformTag, process.env.DOM_TOKEN);
    if (!domToken) return false;
    const gateway = this.gateways.byAcquirer(acquirer);
    const token = await this.tokenSource.fetchToken({
      gateway,
      domToken,
      acquirerCode: acquirer,
      contractId,
    });
    if (!token) return false;
    return this.persistCard(
      contract,
      contract.customerEmail ?? '',
      acquirer,
      token,
    );
  }

  /** Validates the card payload for the active token source and returns only safe metadata. */
  private cardMetadata(
    card: NonNullable<OfferSubscribeDto['card']>,
  ): PendingCard {
    if (this.tokenSource.kind === 'customer-token') {
      if (card.number !== undefined || card.cvv !== undefined)
        throw new BadRequestException(
          'Número e CVV do cartão não são aceitos: envie apenas o token',
        );
      const expiry = parseExpiry(card.exp_month, card.exp_year);
      if (
        !card.token ||
        !card.customerId ||
        !/^\d{4}$/.test(card.last4 ?? '') ||
        !card.holder_name ||
        !expiry
      )
        throw new BadRequestException('Dados do cartão inválidos');
      return {
        brand: card.brand ?? null,
        last4: card.last4!,
        ...expiry,
        customerId: card.customerId,
        encryptedToken: encryptPlatformSecret(card.token),
      };
    }
    if (!card.number || !card.cvv || !card.holder_document)
      throw new BadRequestException('Dados do cartão são obrigatórios');
    const digits = card.number.replace(/\D/g, '');
    const expiry = parseExpiry(card.exp_month, card.exp_year);
    if (digits.length < 12 || digits.length > 19 || !expiry)
      throw new BadRequestException('Dados do cartão inválidos');
    return {
      brand: card.brand ?? null,
      last4: digits.slice(-4),
      ...expiry,
    };
  }

  /**
   * trialDays > 0 (customer-token only): the card is stored now, the contract becomes ACTIVE
   * with `nextChargeAt = now + trialDays` and no charge exists. BillingCycleService.runDue issues
   * the first Charge at the end of the trial, with the same amount as every later cycle.
   */
  private async startTrial(
    offer: Offer,
    input: OfferSubscribeDto,
    ctx: {
      email: string;
      acquirer: Acquirer;
      pendingCard: PendingCard;
      now: Date;
    },
  ): Promise<OfferSubscribeResult> {
    const { email, acquirer, pendingCard, now } = ctx;
    const claimed = await this.prisma.offer.updateMany({
      where: {
        id: offer.id,
        isActive: true,
        ...(offer.maxUses !== null ? { usedCount: { lt: offer.maxUses } } : {}),
      },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count !== 1)
      throw new BadRequestException('Limite de usos da oferta atingido');
    let contract: BillingContract;
    let charge: Charge;
    try {
      ({ contract, charge } = await this.billing.subscribe({
        offerId: offer.id,
        customerName: input.customerName,
        customerEmail: email,
        customerDocument: input.customerDocument.replace(/\D/g, ''),
        now,
      }));
    } catch (error) {
      await this.releaseUse(offer.id);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.existingContract(offer, email);
        if (winner) return this.describe(offer, winner, true);
      }
      throw error;
    }
    try {
      await this.prisma.billingContract.update({
        where: { id: contract.id },
        data: {
          acquirer,
          description: offer.name.slice(0, 120),
          metadata: { pendingCard } as unknown as Prisma.InputJsonValue,
        },
      });
      await this.persistCard(
        contract,
        email,
        acquirer,
        decryptPlatformSecret(pendingCard.encryptedToken!),
      );
      await this.prisma.$transaction(async (p) => {
        // No charge during the trial: runDue creates the first one at nextChargeAt.
        await p.charge.deleteMany({ where: { id: charge.id } });
        await p.billingContract.update({
          where: { id: contract.id },
          data: { status: 'ACTIVE', version: { increment: 1 } },
        });
      });
    } catch (error) {
      await this.prisma.storedCard
        .deleteMany({ where: { contractId: contract.id } })
        .catch(() => undefined);
      await this.discard(offer.id, contract.id, charge.id, randomUUID()).catch(
        () => undefined,
      );
      throw error;
    }
    return this.describe(offer, contract, false);
  }

  private async storeCard(
    contract: BillingContract,
    email: string,
    acquirer: string,
    knownToken: string | null,
    ctx: {
      gateway: ReturnType<PaymentGatewayResolver['byAcquirer']>;
      domToken: string;
    },
  ): Promise<void> {
    try {
      const token =
        knownToken ??
        (await this.tokenSource.fetchToken({
          gateway: ctx.gateway,
          domToken: ctx.domToken,
          acquirerCode: acquirer,
          contractId: contract.id,
        }));
      if (token) await this.persistCard(contract, email, acquirer, token);
      else
        this.logger.warn(
          `Contrato ${contract.id} pago sem token reutilizável; captura pendente`,
        );
    } catch (error) {
      // A cobrança já foi paga: não desfaz. Só o token fica pendente (completeCardCapture).
      this.logger.error(
        `Contrato ${contract.id}: falha ao guardar o cartão (${(error as Error).message})`,
      );
    }
  }

  /**
   * Moves the pending card of a contract into the vault exactly once: a per-contract advisory
   * lock serializes concurrent captures (checkout + webhook) and the pending marker is cleared
   * in the same transaction that decides, so the second caller finds nothing to do.
   */
  private async persistCard(
    contract: BillingContract,
    email: string,
    acquirer: string,
    token: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`card-capture:${contract.id}`}))`;
        const fresh = await tx.billingContract.findUnique({
          where: { id: contract.id },
          select: { metadata: true },
        });
        const meta = (fresh?.metadata as { pendingCard?: PendingCard } | null)
          ?.pendingCard;
        if (!meta) return false;
        await this.vault.save({
          ownerUserId: contract.userId,
          contractId: contract.id,
          customerEmail: email,
          acquirerCode: acquirer,
          token,
          acquirerCustomerId: meta.customerId ?? null,
          brand: meta.brand,
          last4: meta.last4,
          expMonth: meta.expMonth,
          expYear: meta.expYear,
        });
        await tx.billingContract.update({
          where: { id: contract.id },
          data: { metadata: Prisma.DbNull },
        });
        return true;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /** Contract of this buyer for the offer. A never-paid cancelled one frees the key for a new attempt. */
  private async existingContract(
    offer: Offer,
    email: string,
  ): Promise<BillingContract | null> {
    const resourceId = resourceIdOf(offer.id, email);
    const contract = await this.prisma.billingContract.findUnique({
      where: { resourceType_resourceId: { resourceType: 'OFFER', resourceId } },
    });
    if (!contract) return null;
    if (contract.status === 'CANCELLED' || contract.status === 'SUSPENDED') {
      const paid = await this.prisma.charge.count({
        where: { contractId: contract.id, status: 'PAID' },
      });
      if (contract.status === 'CANCELLED' && paid === 0) {
        await this.prisma.billingContract.update({
          where: { id: contract.id },
          data: { resourceId: `${resourceId}:void:${contract.id}` },
        });
        return null;
      }
      throw new ConflictException(
        'Já existe uma assinatura encerrada para este e-mail nesta oferta; fale com o suporte para reativá-la',
      );
    }
    return contract;
  }

  private async describe(
    offer: Offer,
    contract: BillingContract,
    existing: boolean,
  ): Promise<OfferSubscribeResult> {
    const fresh = await this.prisma.billingContract.findUniqueOrThrow({
      where: { id: contract.id },
    });
    const first = await this.prisma.charge.findFirst({
      where: { contractId: contract.id },
      orderBy: { createdAt: 'asc' },
      include: { transaction: true },
    });
    const metadata = (offer.metadata ?? {}) as Record<string, unknown>;
    const pix =
      offer.renewalMode === 'MANUAL_PAY' && first?.status === 'PENDING'
        ? {
            pixContent: first?.transaction?.pixContent ?? null,
            qrCode: null,
            pixExpire: first?.transaction?.pixExpire?.toISOString() ?? null,
          }
        : null;
    const storedCards = await this.prisma.storedCard.count({
      where: { contractId: contract.id, status: 'ACTIVE' },
    });
    return {
      contractId: contract.id,
      chargeId: first?.id ?? null,
      transactionId: first?.transactionId ?? null,
      existing,
      contractStatus: fresh.status,
      chargeStatus: first?.status ?? 'TRIAL',
      renewalMode: offer.renewalMode,
      amount: (first?.amountCents ?? offer.amountCents) / 100,
      nextChargeAt: fresh.nextChargeAt?.toISOString() ?? null,
      cardSaved: storedCards > 0,
      pix,
      redirectUrl:
        typeof metadata.redirectUrl === 'string' ? metadata.redirectUrl : null,
    };
  }

  private releaseUse(offerId: string) {
    return this.prisma.offer.updateMany({
      where: { id: offerId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }

  /** Rejeição sem cobrança comprovada: apaga tudo e devolve a reserva, liberando nova tentativa. */
  private async discard(
    offerId: string,
    contractId: string,
    chargeId: string,
    txId: string,
  ) {
    await this.prisma.$transaction(async (p) => {
      await p.charge.deleteMany({ where: { id: chargeId } });
      await p.transaction.deleteMany({
        where: { id: txId, status: TransactionStatus.DRAFT },
      });
      await p.billingContract.deleteMany({ where: { id: contractId } });
      await p.offer.updateMany({
        where: { id: offerId, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
    });
  }

  /** Link do adquirente da oferta (compartilhado com o checkout avulso via ExternalRef). */
  private async gatewayLinkId(
    offer: Offer,
    acquirer: string,
    domToken: string,
    gateway: ReturnType<PaymentGatewayResolver['byAcquirer']>,
  ): Promise<string> {
    const target = { entityType: 'Offer', entityId: offer.id };
    const known = await this.refs.externalIdFor(
      target,
      acquirer,
      'PAYMENT_LINK',
    );
    if (known) return known;
    const created = await gateway.createPaymentLink(
      domToken,
      offerGatewayLinkInput(offer),
    );
    try {
      await this.refs.link(acquirer, 'PAYMENT_LINK', created.id, target);
      return created.id;
    } catch (error) {
      const winner = await this.refs.externalIdFor(
        target,
        acquirer,
        'PAYMENT_LINK',
      );
      if (winner) return winner;
      throw error;
    }
  }
}
