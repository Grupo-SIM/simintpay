import { isDomCashbackActive } from '../platform-taxas/platform-taxas.store';
import { cyclePolicyTag } from '../billing-core/cycle-pricing';
import { findOfferByCodeOrId } from './find-offer-by-code-or-id';
import { randomUUID } from 'node:crypto';
import { coproductionKeyFor } from './offer-coproduction';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TransactionStatus,
  type BillingContract,
  type Charge,
  type Offer,
} from '@prisma/client';
import { platformGatewayToken } from '../../application/helpers/explicit-platform.helper';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import { isReactivationCharge } from '../billing-core/contract-advance';
import {
  frozenQuoteFrom,
  frozenQuoteSnapshot,
  priceOfferCycle,
} from '../billing-core/cycle-pricing';
import { ExternalRefService } from '../billing-core/external-ref.service';
import { verifyRenewalSignature } from '../billing-core/renewal-signature';
import {
  captureCoproduction,
  withCoproduction,
} from '../coproduction/coproduction.service';
import { persistLinkCharge } from '../platform-core/link-settlement';
import { transactionPlatformTagData } from '../platform-core/transaction-platform';
import type { OfferRenewDto } from './offer-renewal.dto';

export type OfferRenewResult = {
  contractId: string;
  chargeId: string;
  transactionId: string;
  /** CYCLE: PIX of the open cycle charge. REACTIVATION: new charge that reopens the contract. */
  kind: 'CYCLE' | 'REACTIVATION';
  /** True when a still valid PIX of this charge was returned instead of issuing a new one. */
  existing: boolean;
  contractStatus: string;
  chargeStatus: string;
  attempts: number;
  amount: number;
  pix: {
    pixContent: string | null;
    qrCode: string | null;
    pixExpire: string | null;
  };
};

const BAD_LINK = 'Link de renovação inválido ou expirado';

/**
 * Renewal / reactivation by PIX from a signed link (no login). The HMAC of the contract id is
 * the only authorization; a bad signature answers the same 403 whether or not the contract
 * exists. Everything for one contract runs under a transaction-level advisory lock, so two
 * simultaneous calls create one Charge and one PIX. Payment is settled by the usual webhook
 * path (markChargeSettled -> advanceContractForCharge); nothing here advances the contract.
 */
@Injectable()
export class OfferRenewalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewayResolver,
    private readonly refs: ExternalRefService,
  ) {}

  async renew(
    code: string,
    input: OfferRenewDto,
    now = new Date(),
  ): Promise<OfferRenewResult> {
    if (!verifyRenewalSignature(input.contractId, input.sig))
      throw new ForbiddenException(BAD_LINK);
    const offer = await findOfferByCodeOrId(this.prisma, code);
    const probe = await this.prisma.billingContract.findUnique({
      where: { id: input.contractId },
      select: { id: true, offerId: true, resourceType: true },
    });
    if (
      !offer ||
      !probe ||
      probe.resourceType !== 'OFFER' ||
      probe.offerId !== offer.id
    )
      throw new NotFoundException('Assinatura não encontrada');

    const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
    const acquirer = this.gateways.acquirerForSlug(platformTag);
    const gateway = this.gateways.byAcquirer(acquirer);
    if (!this.gateways.capabilitiesFor(acquirer).methods.has('PIX'))
      throw new ConflictException(
        'O adquirente desta oferta não suporta PIX para renovação',
      );
    const domToken = platformGatewayToken(platformTag, process.env.DOM_TOKEN);
    if (!domToken)
      throw new ConflictException('Token do gateway não configurado');

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`renew:${probe.id}`}, 0))`;
        const contract = await tx.billingContract.findUniqueOrThrow({
          where: { id: probe.id },
        });
        const { charge, kind } = await this.resolveCharge(
          tx,
          offer,
          contract,
          now,
        );
        return this.issuePix(tx, {
          offer,
          contract,
          charge,
          kind,
          platformTag,
          acquirer,
          gateway,
          domToken,
          now,
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /** Decides which Charge the PIX pays: the open cycle charge, or a (new) reactivation charge. */
  private async resolveCharge(
    tx: Prisma.TransactionClient,
    offer: Offer,
    contract: BillingContract,
    now: Date,
  ): Promise<{ charge: Charge; kind: 'CYCLE' | 'REACTIVATION' }> {
    if (contract.status === 'CANCELLED')
      throw new ConflictException(
        'Esta assinatura foi cancelada e não pode ser renovada; contrate a oferta novamente.',
      );
    const paidCycles = await tx.charge.count({
      where: { contractId: contract.id, status: 'PAID' },
    });
    if (paidCycles === 0)
      throw new ConflictException(
        'Esta assinatura nunca foi paga; contrate a oferta novamente.',
      );

    if (contract.status === 'ACTIVE' || contract.status === 'PAST_DUE') {
      const open = await tx.charge.findFirst({
        where: { contractId: contract.id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      if (!open || isReactivationCharge(open))
        throw new ConflictException(
          'Sua assinatura está em dia; não há cobrança em aberto para pagar.',
        );
      // A card charge still awaiting the acquirer must not be paid twice: only charges handed to
      // the buyer (buyer-paid or with a CHARGE_DUE notice) can be paid by link.
      const snapshot = open.snapshot as Record<string, unknown> | null;
      const notified =
        snapshot?.buyerPaid === true ||
        (await tx.billingContractEvent.count({
          where: {
            contractId: contract.id,
            type: 'CHARGE_DUE',
            eventKey: { startsWith: `charge-due:${open.id}:` },
          },
        })) > 0;
      if (!notified)
        throw new ConflictException(
          'Sua cobrança está em processamento; aguarde a confirmação do pagamento.',
        );
      return { charge: open, kind: 'CYCLE' };
    }

    // SUSPENDED, or INACTIVE after the period lapsed (not finished by `repetitions`).
    if (
      offer.repetitions != null &&
      offer.repetitions > 0 &&
      paidCycles >= offer.repetitions
    )
      throw new ConflictException(
        'Esta assinatura foi concluída e não pode ser renovada.',
      );
    if (
      !offer.isActive ||
      !['AUTO_CHARGE', 'MANUAL_PAY'].includes(offer.renewalMode)
    )
      throw new ConflictException(
        'Esta oferta não está disponível para renovação.',
      );
    if (!offer.acceptedMethods.includes('PIX'))
      throw new ConflictException(
        'Esta oferta não aceita PIX para reativação.',
      );

    const cycleKey = `reactivation:${(contract.suspendedAt ?? contract.currentPeriodEnd).toISOString()}`;
    const existing = await tx.charge.findUnique({
      where: { contractId_cycleKey: { contractId: contract.id, cycleKey } },
    });
    if (existing?.status === 'PAID')
      throw new ConflictException('Esta assinatura já foi reativada.');
    if (existing) {
      if (existing.status === 'PENDING')
        return { charge: existing, kind: 'REACTIVATION' };
      return {
        charge: await tx.charge.update({
          where: { id: existing.id },
          data: { status: 'PENDING' },
        }),
        kind: 'REACTIVATION',
      };
    }
    const quote = await priceOfferCycle(tx as never, offer, 'PIX', 1, now);
    const charge = await tx.charge.create({
      data: {
        offerId: offer.id,
        contractId: contract.id,
        ownerUserId: contract.userId,
        amountCents: Math.round(quote.totalAmount * 100),
        method: 'PIX',
        snapshot: {
          ...(frozenQuoteSnapshot(quote, now) as Record<string, unknown>),
          reactivation: true,
          buyerPaid: true,
        } as Prisma.InputJsonValue,
        currency: offer.currency,
        dueAt: now,
        cycleKey,
        attempts: 0,
        customerName: contract.customerName,
        customerEmail: contract.customerEmail,
        customerDocument: contract.customerDocument,
      },
    });
    return { charge, kind: 'REACTIVATION' };
  }

  /** Returns the still valid PIX of the charge, or issues a new one (new attempt) at the frozen amount. */
  private async issuePix(
    tx: Prisma.TransactionClient,
    ctx: {
      offer: Offer;
      contract: BillingContract;
      charge: Charge;
      kind: 'CYCLE' | 'REACTIVATION';
      platformTag: string;
      acquirer: ReturnType<PaymentGatewayResolver['acquirerForSlug']>;
      gateway: ReturnType<PaymentGatewayResolver['byAcquirer']>;
      domToken: string;
      now: Date;
    },
  ): Promise<OfferRenewResult> {
    const { offer, contract, charge, kind, now } = ctx;
    const result = (
      c: Charge,
      transactionId: string,
      pix: OfferRenewResult['pix'],
      existing: boolean,
    ): OfferRenewResult => ({
      contractId: contract.id,
      chargeId: c.id,
      transactionId,
      kind,
      existing,
      contractStatus: contract.status,
      chargeStatus: c.status,
      attempts: c.attempts,
      amount: c.amountCents / 100,
      pix,
    });

    if (charge.transactionId) {
      const previous = await tx.transaction.findUnique({
        where: { id: charge.transactionId },
      });
      if (
        previous?.status === TransactionStatus.PENDING &&
        previous.pixContent &&
        (!previous.pixExpire || previous.pixExpire > now)
      )
        return result(
          charge,
          previous.id,
          {
            pixContent: previous.pixContent,
            qrCode: null,
            pixExpire: previous.pixExpire?.toISOString() ?? null,
          },
          true,
        );
      // Expired PIX: close it so a late payment of the old code cannot be mistaken for the new one.
      if (previous && previous.status === TransactionStatus.PENDING)
        await tx.transaction.updateMany({
          where: { id: previous.id, status: TransactionStatus.PENDING },
          data: { status: TransactionStatus.EXPIRED },
        });
    }

    const frozen = frozenQuoteFrom(charge);
    if (!frozen)
      throw new ConflictException(
        'Cobrança sem valor congelado para renovação',
      );
    if (!contract.customerDocument || !contract.customerEmail)
      throw new ConflictException(
        'Dados do comprador incompletos; fale com o suporte.',
      );
    const document = contract.customerDocument.replace(/\D/g, '');
    const amount = charge.amountCents / 100;
    const key = coproductionKeyFor(offer);
    const coproduction = await captureCoproduction(
      tx,
      key.product,
      key.productId,
      offer.ownerUserId,
      offer.platformTag ? ctx.platformTag : undefined,
    );
    const base =
      kind === 'REACTIVATION'
        ? `${offer.name} (reativação)`
        : `${offer.name} (renovação)`;
    const txId = randomUUID();
    const snapshot = {
      financialSnapshot: withCoproduction(
        frozen.financialSnapshot,
        coproduction,
      ),
      userId: offer.ownerUserId,
      amount: new Prisma.Decimal(amount),
      netAmount: new Prisma.Decimal(frozen.netAmount),
      paymentMethod: 'PIX' as const,
      totalFee: new Prisma.Decimal(frozen.totalFee),
      acquirerFee: new Prisma.Decimal(frozen.domFee),
      platformFee: new Prisma.Decimal(frozen.platformFee),
      description:
        ctx.platformTag !== 'GLOBAL'
          ? `${base} [TENANT:${ctx.platformTag}]`
          : base,
      ...transactionPlatformTagData(ctx.platformTag),
      customerName: contract.customerName ?? '',
      customerEmail: contract.customerEmail,
      customerDocument: document,
      customerPhone: null,
      installments: 1,
    };
    await tx.wallet.upsert({
      where: { userId: offer.ownerUserId },
      update: {},
      create: { userId: offer.ownerUserId, balance: 0 },
    });
    await tx.transaction.create({
      data: {
        ...snapshot,
        id: txId,
        status: 'DRAFT',
        settlementBasis: 'FINAL_NET',
      },
    });
    const domLinkId = await this.gatewayLinkId(offer, ctx);
    const pix = await ctx.gateway.chargePixForLink(ctx.domToken, {
      cashbackDisabled: !isDomCashbackActive(cyclePolicyTag(offer)),
      domLinkId,
      amount,
      description: `${snapshot.description} [LINK_CHARGE:${txId}]`,
      customerName: contract.customerName ?? '',
      customerEmail: contract.customerEmail,
      customerDocument: document,
      customerPhone: '',
      documentType: document.length === 14 ? 'CNPJ' : 'CPF',
      codExternal: txId,
    });
    await persistLinkCharge(
      tx,
      {
        ...snapshot,
        domPaymentId: pix.id,
        pixContent: pix.pixContent ?? null,
        pixExpire: pix.pixExpire ? new Date(pix.pixExpire) : null,
      } as never,
      TransactionStatus.PENDING,
      txId,
    );
    const updated = await tx.charge.update({
      where: { id: charge.id },
      data: {
        transactionId: txId,
        method: 'PIX',
        attempts: { increment: 1 },
        snapshot: {
          ...((charge.snapshot as Record<string, unknown> | null) ?? {}),
          buyerPaid: true,
        } as Prisma.InputJsonValue,
      },
    });
    return result(
      updated,
      txId,
      {
        pixContent: pix.pixContent ?? null,
        qrCode: pix.qrCode ?? null,
        pixExpire: pix.pixExpire ?? null,
      },
      false,
    );
  }

  /** Link do adquirente da oferta (mesmo ExternalRef do checkout: criado uma vez por oferta). */
  private async gatewayLinkId(
    offer: Offer,
    ctx: {
      acquirer: string;
      gateway: ReturnType<PaymentGatewayResolver['byAcquirer']>;
      domToken: string;
    },
  ): Promise<string> {
    const target = { entityType: 'Offer', entityId: offer.id };
    const known = await this.refs.externalIdFor(
      target,
      ctx.acquirer,
      'PAYMENT_LINK',
    );
    if (known) return known;
    const created = await ctx.gateway.createPaymentLink(ctx.domToken, {
      title: offer.name,
      description: offer.description,
      amount: offer.amountCents / 100,
      maxInstallments: offer.maxInstallments,
      interestRateInstallment: 0,
      aceitaCartao: offer.acceptedMethods.some((m) => m.endsWith('_CARD')),
      aceitaPix: offer.acceptedMethods.includes('PIX'),
    });
    try {
      await this.refs.link(ctx.acquirer, 'PAYMENT_LINK', created.id, target);
      return created.id;
    } catch (error) {
      const winner = await this.refs.externalIdFor(
        target,
        ctx.acquirer,
        'PAYMENT_LINK',
      );
      if (winner) return winner;
      throw error;
    }
  }
}
