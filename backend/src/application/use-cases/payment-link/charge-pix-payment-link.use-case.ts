import { captureCoproduction, withCoproduction } from '../../../modules/coproduction/coproduction.service';
import { loadChargePolicy, quoteFinancialCharge } from '../../../modules/financial-policy/financial-charge';
import { paymentTracking } from '../../../modules/platform-core/payment-tracking';
import { randomUUID } from 'node:crypto';
import { persistLinkCharge } from '../../../modules/platform-core/link-settlement';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { getModuleDomToken } from '../../../modules/module.registry';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { calculatePaymentLinkFees } from './payment-link-fees.helper';
import { buildClientTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { clientTaxaTagFor } from '../../helpers/client-rules.helper';
import { isAreaflixLink, calculateAreaflixSellerNet } from '../../helpers/areaflix-fees.helper';
import { offersDescriptionSuffix, recordOfferSales, resolveFunnelOffer, resolveOrderBumps, sumOffers } from './payment-link-offers.helper';

export type ChargePixPaymentLinkInput = {
  tracking?: Record<string, string>;
  linkId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone?: string;
  documentType?: 'CPF' | 'CNPJ';
  /** Order bumps marcados no checkout (somados ao pedido principal) */
  orderBumpIds?: string[];
  /** Upsell/downsell pós-compra: cobra só a oferta, vinculada ao pedido principal */
  offerId?: string;
  /** domPaymentId ou id da transação do pedido principal (obrigatório com offerId) */
  parentPaymentId?: string;
};

export type ChargePixPaymentLinkOutput = {
  id: string;
  transactionId: string;
  status: string;
  pixContent: string | null;
  qrCode: string | null;
  pixExpire: string | null;
  amount: number;
};

const PLAN_PLATFORM_CPF_REGEX = /\[CPF:([^\]|]*)\|([^\]]+)\]/;

@Injectable()
export class ChargePixPaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  private extractOwnerDocumentDigits(description: string | null | undefined): string | null {
    const m = (description ?? '').match(PLAN_PLATFORM_CPF_REGEX);
    if (!m) return null;
    const digits = m[1].replace(/\D/g, '');
    if (digits.length < 11) return null;
    return digits;
  }

  private async resolveMerchantUserIdByDocument(description: string | null | undefined, fallbackUserId: string): Promise<string> {
    const owner = await this.prisma.user.findUnique({
      where: { id: fallbackUserId },
      select: { email: true },
    });
    const isPlatformShadow = (owner?.email ?? '').toLowerCase().endsWith('@auto.simpay.com');
    if (!isPlatformShadow) return fallbackUserId;

    const digits = this.extractOwnerDocumentDigits(description);
    if (!digits) return fallbackUserId;

    const variants: string[] = [digits];
    if (digits.length === 11) {
      variants.push(digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));
    } else if (digits.length === 14) {
      variants.push(digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'));
    }

    const merchant = await this.prisma.user.findFirst({
      where: { OR: variants.map((cpf) => ({ cpf })) },
      select: { id: true },
    });
    return merchant?.id ?? fallbackUserId;
  }

  async execute(input: ChargePixPaymentLinkInput): Promise<ChargePixPaymentLinkOutput> {
    const link = await this.links.findById(input.linkId);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link de pagamento não encontrado ou inativo');
    }
    if ((link as any).expiresAt && new Date((link as any).expiresAt).getTime() <= Date.now()) {
      throw new NotFoundException('Link de pagamento expirado');
    }
    const isFunnel = Boolean(input.offerId);
    // Upsell/downsell complementam um pedido já contabilizado — não consomem uso do link.
    if (!isFunnel && (link as any).maxUses != null && (link as any).currentUses >= (link as any).maxUses) {
      throw new BadRequestException('Limite de usos do link atingido');
    }
    if (!link.domPaymentLinkId) {
      throw new BadRequestException('Link ainda não sincronizado com o gateway');
    }
    if (!link.aceitaPix) {
      throw new BadRequestException('Este link não aceita pagamento via PIX');
    }

    const funnel = isFunnel
      ? await resolveFunnelOffer(this.prisma, {
          paymentLinkId: link.id,
          offerId: input.offerId!,
          parentPaymentId: input.parentPaymentId,
          customerEmail: input.customerEmail ?? '',
        })
      : null;
    const bumps = funnel ? [] : await resolveOrderBumps(this.prisma, link.id, input.orderBumpIds);
    const soldOffers = funnel ? [funnel.offer] : bumps;
    // Taxas são calculadas sobre o valor efetivamente cobrado (oferta ou link + order bumps).
    const chargedBase = funnel ? Number(funnel.offer.price) : Number(link.amount) + sumOffers(bumps);
    const pricedLink = { ...link, amount: new Prisma.Decimal(chargedBase) };

    const owner = await this.users.findById(link.userId);
    const ownerClientTag = !['GLOBAL', 'SIMINTPAY'].includes(((link as any).plataformas?.[0] ?? 'GLOBAL').toUpperCase()) ? null : clientTaxaTagFor(owner);

    const isAreaflix = isAreaflixLink({
      webhookUrl: (link as any).webhookUrl,
      plataformas: (link as any).plataformas,
    });

    // Cliente SimintPay e Areaflix usam o token mestre (SimintPay) sempre.
    const selectedTag = (link as any).plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL';
    const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);

    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const document = input.customerDocument.replace(/\D/g, '');
    const documentType = input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF');
    const phone = (input.customerPhone ?? '').replace(/\D/g, '');

    // PIX é sempre 1 parcela sem juros — comprador paga exatamente o valor base do link
    const platformTag = ((link as any).plataformas?.[0] as string | undefined)?.toUpperCase()
      || owner?.platform?.tag?.toUpperCase()
      || 'GLOBAL';
    // Taxa: dono cliente SimintPay → tag do dono (CLIENT:<owner>); senão regra antiga por comprador.
    const taxaTag = ownerClientTag
      ?? (platformTag === 'GLOBAL' && input.customerEmail?.trim()
        ? buildClientTaxaTag(input.customerEmail)
        : platformTag);
    const financialQuote = quoteFinancialCharge(await loadChargePolicy(this.prisma, platformTag), chargedBase, 'PIX');
    const fees = financialQuote ?? calculatePaymentLinkFees(pricedLink, 1, taxaTag, true);
    const { totalAmount, domFeeAmount } = fees;
    let { netAmount } = fees;

    // AREAFLIX: líquido do vendedor = valor − % PIX − taxa fixa (taxas do painel)
    if (isAreaflix && !financialQuote) {
      netAmount = calculateAreaflixSellerNet(totalAmount, 'PIX');
    }


    const effectiveUserId = await this.resolveMerchantUserIdByDocument(link.description, link.userId);

    const totalFee = totalAmount - netAmount;
    const platformFee = totalFee - domFeeAmount;

    const chargeId = randomUUID();
    const baseDescription = funnel
      ? `${link.description ?? link.title} | ${funnel.offer.type === 'UPSELL' ? 'Upsell' : 'Downsell'}: ${funnel.offer.title}`
      : `${link.description ?? link.title}${offersDescriptionSuffix(bumps)}`;
    const coproduction = await captureCoproduction(this.prisma, 'links-pagamento', link.id, effectiveUserId, platformTag);
    const snapshot = {
        financialSnapshot: withCoproduction(financialQuote?.financialSnapshot, coproduction),
        userId: effectiveUserId,
        amount: new Prisma.Decimal(totalAmount),
        netAmount: new Prisma.Decimal(netAmount),

        paymentMethod: PaymentMethod.PIX,
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(domFeeAmount),
        platformFee: new Prisma.Decimal(platformFee),
        description: platformTag !== 'GLOBAL' ? `${baseDescription} [TENANT:${platformTag}]` : baseDescription,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone || null,
        tracking: paymentTracking(input.tracking),
        paymentLinkId: link.id,
    };
    await this.prisma.$transaction(async p => {
      await p.wallet.upsert({ where: { userId: effectiveUserId }, update: {}, create: { userId: effectiveUserId, balance: 0 } });
      await p.transaction.create({ data: { ...snapshot, id: chargeId, status: 'DRAFT', settlementBasis: 'FINAL_NET' } });
    });
    const result = await this.gateway.chargePixForLink(domToken, {
      domLinkId: link.domPaymentLinkId,
      amount: totalAmount,
      description: `${snapshot.description} [LINK_CHARGE:${chargeId}]`,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: document,
      customerPhone: phone,
      documentType,
      codExternal: chargeId,
    });
    const savedTx = await this.prisma.$transaction(p =>
      persistLinkCharge(p, { ...snapshot, domPaymentId: result.id, pixContent: result.pixContent ?? null, pixExpire: result.pixExpire ? new Date(result.pixExpire) : null }, TransactionStatus.PENDING, chargeId));

    await recordOfferSales(this.prisma, {
      paymentLinkId: link.id,
      transactionId: savedTx.id,
      parentTransactionId: funnel?.parentTransactionId ?? null,
      offers: soldOffers,
    });

    // Incrementa contador de usos
    if (!isFunnel) {
      await this.links.update(link.id, {
        currentUses: ((link as any).currentUses ?? 0) + 1,
      });
    }

    return {
      ...result,
      transactionId: savedTx.id,
      amount: totalAmount,
    };
  }
}
