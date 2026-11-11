import { findOfferByCodeOrId } from './find-offer-by-code-or-id';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  Prisma,
  TransactionStatus,
  type Offer,
} from '@prisma/client';
import { normalizeBoletoAddress } from './offer-boleto-address';
import { platformGatewayToken } from '../../application/helpers/explicit-platform.helper';
import { round2 } from '../../application/use-cases/payment-link/payment-link-fees.helper';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../core/repositories/user.repository.interface';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import { ExternalRefService } from '../billing-core/external-ref.service';
import { markChargeSettled } from '../billing-core/charge-settlement';
import { coproductionKeyFor } from './offer-coproduction';
import { boletoDueDaysOf, offerGatewayLinkInput } from './offer-gateway-link';
import {
  captureCoproduction,
  withCoproduction,
} from '../coproduction/coproduction.service';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../financial-policy/financial-charge';
import { paymentTracking } from '../platform-core/payment-tracking';
import { persistLinkCharge } from '../platform-core/link-settlement';
import { transactionPlatformTagData } from '../platform-core/transaction-platform';
import {
  discardDraftOnRejection,
  markPreDispatchNoCharge,
} from '../unified-platform/payments/dom-rejection';
import {
  readOfferFulfillment,
  type ChargeItem,
  type FulfillmentRole,
} from './offer-fulfillment';
import type { OfferChargeDto } from './offer.dto';

const METHODS: Record<OfferChargeDto['paymentMethod'], PaymentMethod> = {
  pix: PaymentMethod.PIX,
  credit_card: PaymentMethod.CREDIT_CARD,
  debit_card: PaymentMethod.DEBIT_CARD,
  boleto: PaymentMethod.BOLETO,
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'cartão de crédito',
  DEBIT_CARD: 'cartão de débito',
  BOLETO: 'boleto',
};

export type OfferChargeResult = {
  id: string;
  transactionId: string;
  chargeId: string;
  status: string;
  pixContent: string | null;
  qrCode?: string | null;
  pixExpire?: string | null;
  amount: number;
  redirectUrl?: string | null;
  /** Só boleto: PDF/URL do boleto, linha digitável e vencimento (null = sem vencimento). */
  boletoUrl?: string | null;
  boletoDigitableLine?: string | null;
  boletoExpiresAt?: string | null;
};

function mapGatewayStatus(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase();
  if (s === 'PAID' || s === 'APPROVED' || s === 'COMPLETED')
    return TransactionStatus.COMPLETED;
  if (s === 'FAILED' || s === 'REJECTED' || s === 'EXPIRED')
    return TransactionStatus.FAILED;
  if (s === 'REFUNDED') return TransactionStatus.REFUNDED;
  if (s === 'CHARGEBACK') return TransactionStatus.CHARGEBACK;
  return TransactionStatus.PENDING;
}

/**
 * Checkout público de uma Offer avulsa (renewalMode NONE): PIX, cartão e boleto. Espelha o fluxo
 * corrigido do link de pagamento (taxas, rascunho FINAL_NET, persistência, coprodução) e
 * grava a Charge canônica. Assinaturas ficam fora de escopo.
 */
@Injectable()
export class OfferCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly gateways: PaymentGatewayResolver,
    private readonly refs: ExternalRefService,
  ) {}

  async charge(
    code: string,
    input: OfferChargeDto,
    now = new Date(),
  ): Promise<OfferChargeResult> {
    const offer = await findOfferByCodeOrId(this.prisma, code);
    if (
      !offer ||
      !offer.isActive ||
      (offer.expiresAt && offer.expiresAt <= now)
    )
      throw new NotFoundException('Oferta não encontrada');
    const isFunnel = Boolean(input.parentChargeId);
    // Upsell/downsell não consome a cota da oferta (como no link legado).
    if (!isFunnel && offer.maxUses !== null && offer.usedCount >= offer.maxUses)
      throw new BadRequestException('Limite de usos da oferta atingido');
    if (offer.renewalMode !== 'NONE')
      throw new BadRequestException(
        'Ofertas de assinatura ainda não têm checkout público; use uma oferta avulsa',
      );

    const method = METHODS[input.paymentMethod];
    if (!method) throw new BadRequestException('Meio de pagamento inválido');
    if (!offer.acceptedMethods.includes(method))
      throw new BadRequestException(
        `Esta oferta não aceita pagamento via ${METHOD_LABEL[method]}`,
      );
    const isPix = method === PaymentMethod.PIX;
    const isDebit = method === PaymentMethod.DEBIT_CARD;
    const isBoleto = method === PaymentMethod.BOLETO;
    if (isBoleto && (isFunnel || input.bumpCodes?.length))
      throw new BadRequestException(
        'Boleto não aceita order bumps nem upsell/downsell; escolha PIX ou cartão',
      );
    // Endereço é obrigatório para boleto (mesma regra e mensagem do boleto legado).
    const boletoAddress = isBoleto ? normalizeBoletoAddress(input) : null;
    const installments =
      isPix || isDebit || isBoleto ? 1 : (input.installments ?? 1);
    if (
      !Number.isInteger(installments) ||
      installments < 1 ||
      installments > offer.maxInstallments
    )
      throw new BadRequestException(
        `Parcelamento permitido: de 1 a ${offer.maxInstallments}`,
      );
    if (!isPix && !isBoleto && !input.card)
      throw new BadRequestException('Dados do cartão são obrigatórios');

    const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
    const acquirer = this.gateways.acquirerForSlug(platformTag);
    const capabilities = this.gateways.capabilitiesFor(acquirer);
    if (!capabilities.methods.has(method))
      throw new BadRequestException(
        `O adquirente desta oferta não suporta ${METHOD_LABEL[method]}`,
      );
    if (installments > capabilities.maxInstallments)
      throw new BadRequestException(
        `O adquirente desta oferta permite até ${capabilities.maxInstallments} parcelas`,
      );
    const gateway = this.gateways.byAcquirer(acquirer);

    const domToken = platformGatewayToken(platformTag, process.env.DOM_TOKEN);
    if (!domToken)
      throw new BadRequestException('Token do gateway não configurado');

    // ── Funil: upsell/downsell cobra só a oferta ligada a um pedido pago do mesmo comprador;
    //    senão a oferta principal + order bumps escolhidos. Taxas incidem sobre o cobrado. ──
    const funnel = isFunnel ? await this.resolveFunnel(offer, input) : null;
    if (funnel && input.bumpCodes?.length)
      throw new BadRequestException('Upsell/downsell não aceita order bumps');
    const bumps = funnel ? [] : await this.resolveBumps(offer, input, now);
    const items: ChargeItem[] = funnel
      ? [
          {
            role: funnel.role,
            offerId: offer.id,
            title: offer.name,
            amountCents: offer.amountCents,
          },
        ]
      : [
          {
            role: 'MAIN',
            offerId: offer.id,
            title: offer.name,
            amountCents: offer.amountCents,
          },
          ...bumps.map(
            (b): ChargeItem => ({
              role: 'BUMP',
              offerId: b.id,
              title: b.name,
              amountCents: b.amountCents,
            }),
          ),
        ];
    const chargedBaseCents = items.reduce((n, i) => n + i.amountCents, 0);
    const baseAmount = chargedBaseCents / 100;
    const financialContext = await loadChargePolicy(
      this.prisma,
      platformTag,
      undefined,
      offer.ownerUserId,
    );
    const financialQuote = quoteFinancialCharge(
      financialContext,
      baseAmount,
      isPix
        ? 'PIX'
        : isDebit
          ? 'DEBIT_CARD'
          : isBoleto
            ? 'BOLETO'
            : 'CREDIT_CARD',
      installments,
      'ONLINE',
      false,
    );
    if (!financialQuote) {
      throw new BadRequestException(
        'Taxas da plataforma não configuradas para esta modalidade',
      );
    }
    const { totalAmount, domFeeAmount, netAmount } = financialQuote;

    const domFee = round2(domFeeAmount);
    // Boleto grava as mesmas taxas do boleto legado com cotação (ChargeBoletoUseCase).
    const totalFee = isBoleto
      ? financialQuote.platformFeeTotal
      : round2(totalAmount - netAmount);
    const platformFee = isBoleto
      ? financialQuote.platformProfit
      : round2(totalFee - domFee);

    const key = coproductionKeyFor(offer);
    const coproduction = await captureCoproduction(
      this.prisma,
      key.product,
      key.productId,
      offer.ownerUserId,
      platformTag,
    );

    const document = input.customerDocument.replace(/\D/g, '');
    const phone = (input.customerPhone ?? '').replace(/\D/g, '');
    const mainDescription = offer.description
      ? `${offer.name} | ${offer.description}`
      : offer.name;
    const baseDescription = funnel
      ? `${mainDescription} | ${funnel.role === 'UPSELL' ? 'Upsell' : 'Downsell'}`
      : `${mainDescription}${bumps.map((b) => ` + ${b.name}`).join('')}`;
    const txId = randomUUID();
    const snapshot = {
      financialSnapshot: withCoproduction(
        financialQuote.financialSnapshot,
        coproduction,
      ),
      userId: offer.ownerUserId,
      amount: new Prisma.Decimal(totalAmount),
      netAmount: new Prisma.Decimal(netAmount),
      paymentMethod: method,
      totalFee: new Prisma.Decimal(totalFee),
      domFee: new Prisma.Decimal(domFee),
      platformFee: new Prisma.Decimal(platformFee),
      description:
        platformTag !== 'GLOBAL'
          ? `${baseDescription} [TENANT:${platformTag}]`
          : baseDescription,
      ...transactionPlatformTagData(platformTag),
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: document,
      customerPhone: phone || null,
      tracking: paymentTracking(input.tracking),
      installments,
    };

    // ── Gancho gateway: link de pagamento do adquirente, criado na primeira cobrança ──
    const domLinkId = await this.gatewayLinkId(
      offer,
      acquirer,
      domToken,
      gateway,
    );

    // ── Reserva de uso + Charge PENDING + rascunho FINAL_NET (tudo ou nada) ──
    const charge = await this.prisma.$transaction(async (p) => {
      if (!funnel) {
        const claimed = await p.offer.updateMany({
          where: {
            id: offer.id,
            isActive: true,
            ...(offer.maxUses !== null
              ? { usedCount: { lt: offer.maxUses } }
              : {}),
          },
          data: { usedCount: { increment: 1 } },
        });
        if (claimed.count !== 1)
          throw new BadRequestException('Limite de usos da oferta atingido');
      }
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
      return p.charge.create({
        data: {
          offerId: offer.id,
          ownerUserId: offer.ownerUserId,
          amountCents: Math.round(totalAmount * 100),
          currency: offer.currency,
          method,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerDocument: document,
          transactionId: txId,
          attempts: 1,
          snapshot: {
            baseAmountCents: chargedBaseCents,
            items: items as unknown as Prisma.InputJsonValue,
            ...(funnel
              ? {
                  parentChargeId: funnel.parentChargeId,
                  funnelRole: funnel.role,
                }
              : {}),
            installments,
            totalFee,
            domFee,
            platformFee,
            netAmount,
            acquirer,
            financial: (snapshot.financialSnapshot ??
              null) as Prisma.InputJsonValue,
          },
        },
      });
    });

    // Rejeição definitiva do adquirente: descarta rascunho, Charge e devolve a reserva de uso.
    const releasing = {
      transaction: {
        deleteMany: (args: Prisma.TransactionDeleteManyArgs) =>
          this.prisma.$transaction(async (p) => {
            await p.charge.deleteMany({ where: { transactionId: txId } });
            if (!funnel)
              await p.offer.updateMany({
                where: { id: offer.id, usedCount: { gt: 0 } },
                data: { usedCount: { decrement: 1 } },
              });
            return p.transaction.deleteMany(args);
          }),
      },
    } as never;

    const description = `${snapshot.description} [LINK_CHARGE:${txId}]`;
    if (isBoleto) {
      const result = await discardDraftOnRejection(
        releasing,
        txId,
        async () => {
          const out = await gateway.chargeBoletoForLink(domToken, {
            cashbackDisabled: !financialContext.cashbackActive,
            amount: totalAmount,
            description,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerDocument: document,
            customerPhone: phone,
            documentType:
              input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF'),
            codExternal: txId,
            expireDays: boletoDueDaysOf(offer.metadata),
            address: boletoAddress!,
          });
          // O gateway recusou gerar o boleto (failed ou sem link/linha digitável): nada foi
          // emitido, então rascunho, Charge e reserva de uso são descartados.
          if (
            String(out.status ?? '').toLowerCase() === 'failed' ||
            (!out.boletoUrl && !out.digitableLine)
          )
            throw markPreDispatchNoCharge(
              new BadRequestException(
                'Não foi possível gerar o boleto no gateway. Verifique os dados e tente novamente.',
              ),
            );
          return out;
        },
      );
      const saved = await this.persist(
        { ...snapshot, domPaymentId: result.id },
        TransactionStatus.PENDING,
        txId,
        null,
        null,
      );
      const metadata = (offer.metadata ?? {}) as Record<string, unknown>;
      return {
        id: result.id,
        transactionId: saved.id,
        chargeId: charge.id,
        status: result.status ?? 'pending',
        pixContent: null,
        amount: totalAmount,
        redirectUrl:
          readOfferFulfillment(offer.fulfillment).redirectUrl ??
          (typeof metadata.redirectUrl === 'string'
            ? metadata.redirectUrl
            : null),
        boletoUrl: result.boletoUrl ?? null,
        boletoDigitableLine: result.digitableLine ?? null,
        boletoExpiresAt: result.dueDate ?? null,
      };
    }
    if (isPix) {
      const result = await discardDraftOnRejection(releasing, txId, () =>
        gateway.chargePixForLink(domToken, {
          cashbackDisabled: !financialContext.cashbackActive,
          domLinkId,
          amount: totalAmount,
          description,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerDocument: document,
          customerPhone: phone,
          documentType:
            input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF'),
          codExternal: txId,
        }),
      );
      const status = TransactionStatus.PENDING;
      const saved = await this.persist(
        { ...snapshot, domPaymentId: result.id },
        status,
        txId,
        result.pixContent ?? null,
        result.pixExpire ? new Date(result.pixExpire) : null,
      );
      return {
        ...result,
        transactionId: saved.id,
        chargeId: charge.id,
        amount: totalAmount,
      };
    }

    const result = await discardDraftOnRejection(releasing, txId, () =>
      gateway.chargePaymentLink(domToken, {
        cashbackDisabled: !financialContext.cashbackActive,
        domLinkId,
        amount: totalAmount,
        description,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone,
        paymentMethod: input.paymentMethod as Exclude<
          OfferChargeDto['paymentMethod'],
          'boleto'
        >,
        installments,
        card: input.card,
      }),
    );
    const saved = await this.persist(
      { ...snapshot, domPaymentId: result.id },
      mapGatewayStatus(result.status),
      txId,
      result.pixContent ?? null,
      null,
    );
    const metadata = (offer.metadata ?? {}) as Record<string, unknown>;
    return {
      id: result.id,
      transactionId: saved.id,
      chargeId: charge.id,
      status: result.status ?? 'pending',
      pixContent: result.pixContent ?? null,
      amount: totalAmount,
      redirectUrl: funnel
        ? null
        : (readOfferFulfillment(offer.fulfillment).redirectUrl ??
          (typeof metadata.redirectUrl === 'string'
            ? metadata.redirectUrl
            : null)),
    };
  }

  /** Order bumps escolhidos: só os que a oferta principal lista como BUMP (mesmo titular, avulsos e ativos). */
  private async resolveBumps(
    offer: Offer,
    input: OfferChargeDto,
    now: Date,
  ): Promise<Offer[]> {
    const codes = [...new Set(input.bumpCodes ?? [])];
    if (codes.length === 0) return [];
    const allowed = new Set(
      readOfferFulfillment(offer.fulfillment)
        .bumps.filter((b) => b.role === 'BUMP')
        .map((b) => b.offerId),
    );
    const found = await this.prisma.offer.findMany({
      where: { code: { in: codes } },
    });
    const usable = found.filter(
      (o) =>
        allowed.has(o.id) &&
        o.ownerUserId === offer.ownerUserId &&
        o.isActive &&
        o.renewalMode === 'NONE' &&
        o.currency === offer.currency &&
        !(o.expiresAt && o.expiresAt <= now),
    );
    if (usable.length !== codes.length)
      throw new BadRequestException('Order bump indisponível');
    return codes.map((c) => usable.find((o) => o.code === c)!);
  }

  /** Valida upsell/downsell: pedido principal pago, do mesmo comprador, que ainda não comprou esta oferta. */
  private async resolveFunnel(
    offer: Offer,
    input: OfferChargeDto,
  ): Promise<{ role: 'UPSELL' | 'DOWNSELL'; parentChargeId: string }> {
    const parent = await this.prisma.charge.findUnique({
      where: { id: input.parentChargeId! },
      include: { offer: true },
    });
    if (!parent || parent.status !== 'PAID' || !parent.offer)
      throw new BadRequestException('Pedido principal não aprovado');
    if (
      (parent.customerEmail ?? '').trim().toLowerCase() !==
      input.customerEmail.trim().toLowerCase()
    )
      throw new BadRequestException(
        'Pedido principal pertence a outro comprador',
      );
    const link = readOfferFulfillment(parent.offer.fulfillment).bumps.find(
      (b) => b.offerId === offer.id,
    );
    if (
      !link ||
      link.role === 'BUMP' ||
      parent.offer.ownerUserId !== offer.ownerUserId
    )
      throw new NotFoundException('Oferta não encontrada ou inativa');
    const already = await this.prisma.charge.count({
      where: {
        status: 'PAID',
        offerId: offer.id,
        AND: [{ snapshot: { path: ['parentChargeId'], equals: parent.id } }],
      },
    });
    if (already > 0)
      throw new BadRequestException(
        'Oferta pós-compra já adquirida neste pedido',
      );
    return {
      role: link.role as Extract<FulfillmentRole, 'UPSELL' | 'DOWNSELL'>,
      parentChargeId: parent.id,
    };
  }

  /** Persiste o retorno do adquirente e acompanha a Charge no mesmo commit. */
  private persist(
    data: Record<string, unknown>,
    status: TransactionStatus,
    txId: string,
    pixContent: string | null,
    pixExpire: Date | null,
  ) {
    return this.prisma.$transaction(async (p) => {
      const row = await persistLinkCharge(
        p,
        { ...data, pixContent, pixExpire } as never,
        status,
        txId,
      );
      await markChargeSettled(p, row.id, status);
      return row;
    });
  }

  /** ID do link no adquirente; criado na primeira cobrança e guardado em ExternalRef. */
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
      // Corrida: outra primeira cobrança vinculou antes; usa o dela (o link extra fica órfão).
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
