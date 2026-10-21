import { captureCoproduction, withCoproduction } from '../../../modules/coproduction/coproduction.service';
import { loadChargePolicy, quoteFinancialCharge } from '../../../modules/financial-policy/financial-charge';
import { paymentTracking } from '../../../modules/platform-core/payment-tracking';
import { randomUUID } from 'node:crypto';
import { persistLinkCharge } from '../../../modules/platform-core/link-settlement';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { getModuleDomToken } from '../../../modules/module.registry';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { calculatePaymentLinkFees, calculateDebitFees } from './payment-link-fees.helper';
import { buildClientTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { clientTaxaTagFor } from '../../helpers/client-rules.helper';
import { splitDocument } from '../../utils/document.util';
import { isAreaflixLink, calculateAreaflixSellerNet } from '../../helpers/areaflix-fees.helper';
import { offersDescriptionSuffix, recordOfferSales, resolveFunnelOffer, resolveOrderBumps, sumOffers } from './payment-link-offers.helper';
import { resolveLinkDelivery, sendLinkDelivery } from './payment-link-delivery';
import { EmailService } from '../../../infrastructure/email/email.service';
import { StorageService } from '../../../infrastructure/storage/storage.service';

export type ChargePaymentLinkInput = {
  tracking?: Record<string, string>;
  linkId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone: string;
  paymentMethod?: 'credit_card' | 'debit_card' | 'pix';
  installments?: number;
  /** Order bumps marcados no checkout (somados ao pedido principal) */
  orderBumpIds?: string[];
  /** Upsell/downsell pós-compra: cobra só a oferta, vinculada ao pedido principal */
  offerId?: string;
  /** domPaymentId ou id da transação do pedido principal (obrigatório com offerId) */
  parentPaymentId?: string;
  card?: {
    token: string;
    brand?: string;
    bin?: string;
    exp_month: string;
    exp_year: string;
    cvv: string;
    holder_name: string;
    holder_document: string;
    number?: string;
  };
};

const PLAN_PLATFORM_CPF_REGEX = /\[CPF:([^\]|]*)\|([^\]]+)\]/;

@Injectable()
export class ChargePaymentLinkUseCase {
  private readonly logger = new Logger(ChargePaymentLinkUseCase.name);

  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  private mapGatewayStatusToTxStatus(status: string | null | undefined): TransactionStatus {
    const s = (status ?? '').toUpperCase();
    if (s === 'PAID' || s === 'APPROVED' || s === 'COMPLETED') return TransactionStatus.COMPLETED;
    if (s === 'FAILED' || s === 'REJECTED' || s === 'EXPIRED') return TransactionStatus.FAILED;
    if (s === 'REFUNDED') return TransactionStatus.REFUNDED;
    if (s === 'CHARGEBACK') return TransactionStatus.CHARGEBACK;
    return TransactionStatus.PENDING;
  }

  private mapPaymentMethod(method: ChargePaymentLinkInput['paymentMethod']): PaymentMethod {
    if (method === 'debit_card') return PaymentMethod.DEBIT_CARD;
    if (method === 'pix') return PaymentMethod.PIX;
    return PaymentMethod.CREDIT_CARD;
  }

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

  async execute(input: ChargePaymentLinkInput): Promise<{
    id: string;
    transactionId: string;
    status: string;
    pixContent: string | null;
    redirectUrl: string | null;
  }> {
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

    // Resolve domToken: cliente SimintPay SEMPRE usa o token mestre; senão usuário > módulo > global.
    const owner = await this.users.findById(link.userId);
    const ownerClientTag = !['GLOBAL', 'SIMINTPAY'].includes(((link as any).plataformas?.[0] ?? 'GLOBAL').toUpperCase()) ? null : clientTaxaTagFor(owner);
    const selectedTag = (link as any).plataformas?.[0] ?? owner?.platform?.tag ?? 'GLOBAL';
    const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);

    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const installments = input.installments ?? 1;
    // Plataforma: usa a selecionada no link (plataformas[0]) → fallback platform → GLOBAL
    const linkPlatformTag = (link as any).plataformas?.[0]?.toUpperCase() ?? null;
    const platformTag = linkPlatformTag ?? owner?.platform?.tag?.toUpperCase() ?? 'GLOBAL';
    // Taxa: se o DONO do link é cliente SimintPay, usa a tag do dono (CLIENT:<owner>).
    // Senão, mantém a regra antiga (GLOBAL + email do comprador para taxa personalizada por comprador).
    const taxaTag = ownerClientTag
      ?? (platformTag === 'GLOBAL' && input.customerEmail?.trim()
        ? buildClientTaxaTag(input.customerEmail)
        : platformTag);
    const isDebit = input.paymentMethod === 'debit_card';
    const isPix = input.paymentMethod === 'pix';

    // Para débito: comprador paga valor base; taxas (DOM 3,49%+R$1 + plataforma) saem do líquido do vendedor.
    // Para PIX: comprador paga exatamente o valor base, sem juros de parcelamento.
    // Para crédito: cálculo normal com juros repassados ao comprador.
    const financialContext = await loadChargePolicy(this.prisma, platformTag);
    const financialQuote = quoteFinancialCharge(financialContext, chargedBase, isPix ? 'PIX' : isDebit ? 'DEBIT_CARD' : 'CREDIT_CARD', installments);
    const fees = financialQuote ?? (isDebit
      ? (() => {
          const d = calculateDebitFees(pricedLink, taxaTag);
          return {
            totalAmount: d.baseAmount,       // comprador paga o valor base
            netAmount: d.netAmount,
            domFeeAmount: d.domFeeAmount + d.platformFeeAmount, // total de taxas sobre o vendedor
          };
        })()
      : calculatePaymentLinkFees(pricedLink, installments, taxaTag, isPix, false));
    const { totalAmount, domFeeAmount } = fees;
    let { netAmount } = fees;

    // AREAFLIX: líquido do vendedor = valor − % do método − taxa fixa (taxas do painel)
    const isAfLink = isAreaflixLink({
      webhookUrl: (link as any).webhookUrl,
      plataformas: (link as any).plataformas,
    });
    if (isAfLink && !financialQuote) {
      netAmount = calculateAreaflixSellerNet(
        totalAmount,
        isPix ? 'PIX' : isDebit ? 'DEBIT_CARD' : 'CREDIT_CARD',
        installments,
      );
    }


    const effectiveUserId = await this.resolveMerchantUserIdByDocument(link.description, link.userId);

    const customerDocument = input.customerDocument.replace(/\D/g, '');
    const customerPhone = input.customerPhone.replace(/\D/g, '');

    // totalFee consolidado sempre considera a diferença entre cobrado e líquido.
    const totalFee = totalAmount - netAmount;
    const platformFee = totalFee - domFeeAmount;

    const chargeId = randomUUID();
    const baseDescription = funnel
      ? `${link.description ?? link.title} | ${funnel.offer.type === 'UPSELL' ? 'Upsell' : 'Downsell'}: ${funnel.offer.title}`
      : `${link.description ?? link.title}${offersDescriptionSuffix(bumps)}`;
    const coproduction = await captureCoproduction(this.prisma, 'links-pagamento', link.id, effectiveUserId);
    const snapshot = {
        financialSnapshot: withCoproduction(financialQuote?.financialSnapshot, coproduction),
        userId: effectiveUserId,
        amount: new Prisma.Decimal(totalAmount),
        netAmount: new Prisma.Decimal(netAmount),

        paymentMethod: this.mapPaymentMethod(input.paymentMethod),
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(domFeeAmount),
        platformFee: new Prisma.Decimal(platformFee),
        description: platformTag !== 'GLOBAL' ? `${baseDescription} [TENANT:${platformTag}]` : baseDescription,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument,
        customerPhone,
        tracking: paymentTracking(input.tracking),
        paymentLinkId: link.id,
        installments,
    };
    await this.prisma.$transaction(async p => {
      await p.wallet.upsert({ where: { userId: effectiveUserId }, update: {}, create: { userId: effectiveUserId, balance: 0 } });
      await p.transaction.create({ data: { ...snapshot, id: chargeId, status: 'DRAFT', settlementBasis: 'FINAL_NET' } });
    });
    const result = await this.gateway.chargePaymentLink(domToken, {
      domLinkId: link.domPaymentLinkId,
      amount: totalAmount,
      description: `${snapshot.description} [LINK_CHARGE:${chargeId}]`,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: input.customerDocument.replace(/\D/g, ''),
      customerPhone: input.customerPhone.replace(/\D/g, ''),
      paymentMethod: input.paymentMethod ?? 'credit_card',
      installments,
      card: input.card,
    });
    const tx = await this.prisma.$transaction(p =>
      persistLinkCharge(p, { ...snapshot, domPaymentId: result.id, pixContent: result.pixContent ?? null }, this.mapGatewayStatusToTxStatus(result.status), chargeId));

    await recordOfferSales(this.prisma, {
      paymentLinkId: link.id,
      transactionId: tx.id,
      parentTransactionId: funnel?.parentTransactionId ?? null,
      offers: soldOffers,
    });

    // Incrementa contador de usos
    if (!isFunnel) {
      await this.links.update(link.id, {
        currentUses: ((link as any).currentUses ?? 0) + 1,
      });
    }

    // Cartão aprovado na hora não gera transição de status no webhook DOM —
    // notificar o webhook externo do link (ex: areaflix) e entregar o material aqui.
    // Plataformas com webhook assinado recebem ambos pelo outbox durável.
    const approvedNow = this.mapGatewayStatusToTxStatus(result.status) === TransactionStatus.COMPLETED;
    const needsWebhook = approvedNow && Boolean((link as any).webhookUrl);
    const needsDelivery = approvedNow && Boolean(this.emailService);
    if (
      (needsWebhook || needsDelivery) &&
      !await this.prisma.platformIntegration.findFirst({ where: { key: 'WEBHOOK_SECRET', encryptedValue: { not: null }, platform: { tag: { in: link.plataformas } } } })
    ) {
      void this.afterImmediateApproval(link.id, tx.id, { needsWebhook, needsDelivery }, {
        event: 'purchase_approved',
        customerEmail: input.customerEmail,
        customerName: input.customerName,
        paymentMethod: String(this.mapPaymentMethod(input.paymentMethod)),
        amountCharged: totalAmount,
        netAmount: Number(netAmount.toFixed(2)),
        orderId: tx.id,
        linkId: link.id,
        ...splitDocument(input.customerDocument),
        phone: customerPhone || undefined,
      });
    }

    return {
      id: result.id,
      transactionId: tx.id,
      status: result.status ?? 'pending',
      pixContent: result.pixContent ?? null,
      redirectUrl: (link as any).redirectUrl ?? null,
    };
  }

  /** Entrega por e-mail + webhook externo de uma cobrança aprovada na própria resposta do gateway. */
  private async afterImmediateApproval(
    linkId: string,
    transactionId: string,
    flags: { needsWebhook: boolean; needsDelivery: boolean },
    webhookPayload: Record<string, unknown> & { customerEmail: string; customerName: string },
  ): Promise<void> {
    try {
      const link = await this.prisma.paymentLink.findUnique({ where: { id: linkId }, include: { files: true } });
      if (!link) return;
      // Pedido principal: produto + order bumps. Upsell/downsell: só o material da oferta.
      const delivery = await resolveLinkDelivery(this.prisma, transactionId, link);

      if (flags.needsWebhook && link.webhookUrl) {
        void this.notifyExternalWebhook(link.webhookUrl, {
          ...webhookPayload,
          // Pedido principal mantém o nome do link (plataformas mapeiam o plano por ele).
          planName: delivery.kind === 'OFFER' ? delivery.title : link.title,
          items: delivery.items,
        });
      }

      // Só entrega se ESTA requisição aprovou a transação; se um webhook chegou antes,
      // ele já fez a entrega na transição de status.
      const settledHere = flags.needsDelivery && this.emailService && await this.prisma.transactionStatusHistory.findFirst({
        where: { transactionId, toStatus: TransactionStatus.COMPLETED, metadata: { path: ['source'], equals: 'CHARGE_PAYMENT_LINK' } },
        select: { id: true },
      });
      if (settledHere && this.emailService) {
        await sendLinkDelivery(
          { email: this.emailService, storage: this.storage, logger: this.logger },
          { email: webhookPayload.customerEmail, name: webhookPayload.customerName, transactionId },
          delivery,
        );
      }
    } catch (err: unknown) {
      this.logger.error(`[LinkDelivery] Falha pós-aprovação (tx=${transactionId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async notifyExternalWebhook(
    webhookUrl: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const token = process.env.SIMPAY_WEBHOOK_TOKEN ?? '';
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-simpay-token': token },
        body: JSON.stringify(payload),
      });
    } catch {
      // Falha no webhook externo não pode bloquear a resposta do checkout
    }
  }
}
