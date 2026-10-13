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
import { calculatePaymentLinkFees, calculateDebitFees } from './payment-link-fees.helper';
import { buildClientTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { getEbookTaxaServico } from '../../../modules/ebooksim/ebooksim.config';
import { clientTaxaTagFor } from '../../helpers/client-rules.helper';
import { splitDocument } from '../../utils/document.util';
import { isAreaflixLink, calculateAreaflixSellerNet } from '../../helpers/areaflix-fees.helper';

export type ChargePaymentLinkInput = {
  linkId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone: string;
  paymentMethod?: 'credit_card' | 'debit_card' | 'pix';
  installments?: number;
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
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  private mapGatewayStatusToTxStatus(status: string | null | undefined): TransactionStatus {
    const s = (status ?? '').toUpperCase();
    if (s === 'PAID' || s === 'APPROVED' || s === 'COMPLETED') return TransactionStatus.COMPLETED;
    if (s === 'FAILED' || s === 'REJECTED' || s === 'EXPIRED') return TransactionStatus.FAILED;
    if (s === 'REFUNDED' || s === 'CHARGEBACK') return TransactionStatus.REFUNDED;
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

  /** Mesmo delta do webhook DOM (process-dom-webhook), para wallet e relatórios ficarem consistentes. */
  private resolveWalletDelta(netAmount: number, description: string | null | undefined): Prisma.Decimal {
    const net = new Prisma.Decimal(netAmount);
    if (description?.includes('[TENANT:EBOOK]')) return net.sub(getEbookTaxaServico());
    return net;
  }

  private async creditWalletForApprovedCharge(
    transactionId: string,
    userId: string,
    netAmount: number,
    description: string | null | undefined,
  ): Promise<void> {
    const delta = this.resolveWalletDelta(netAmount, description);

    await this.prisma.$transaction(async (p) => {
      // Idempotência: se o webhook (ou uma chamada anterior) já creditou esta transação, não credita de novo.
      const already = await p.balanceLog.findFirst({
        where: { transactionId, action: { in: ['DOM_WEBHOOK_COMPLETED', 'CHARGE_APPROVED_COMPLETED'] } },
        select: { id: true },
      });
      if (already) return;

      for (let attempt = 0; attempt < 3; attempt++) {
        const wallet = await p.wallet.findUnique({ where: { userId } });
        if (!wallet) return;

        const newBalance = wallet.balance.add(delta);
        const result = await p.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: newBalance, version: { increment: 1 } },
        });

        if (result.count > 0) {
          await p.balanceLog.create({
            data: {
              userId,
              action: 'CHARGE_APPROVED_COMPLETED',
              transactionId,
              amount: delta.abs(),
              balanceBefore: wallet.balance,
              balanceAfter: newBalance,
              lockedBefore: wallet.lockedBalance,
              lockedAfter: wallet.lockedBalance,
              source: 'CHARGE_PAYMENT_LINK',
            },
          });
          return;
        }
      }
      throw new Error('Wallet version conflict after 3 retries');
    });
  }

  async execute(input: ChargePaymentLinkInput): Promise<{
    id: string;
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
    if ((link as any).maxUses != null && (link as any).currentUses >= (link as any).maxUses) {
      throw new BadRequestException('Limite de usos do link atingido');
    }
    if (!link.domPaymentLinkId) {
      throw new BadRequestException('Link ainda não sincronizado com o gateway');
    }

    // Resolve domToken: cliente SimintPay SEMPRE usa o token mestre; senão usuário > módulo > global.
    const owner = await this.users.findById(link.userId);
    const ownerClientTag = clientTaxaTagFor(owner);
    let domToken: string | null | undefined = ownerClientTag ? process.env.DOM_TOKEN : owner?.domToken;

    if (!domToken && !ownerClientTag && owner?.tenantModule?.slug) {
      domToken = getModuleDomToken(owner.tenantModule.slug);
    }

    if (!domToken) {
      domToken = process.env.DOM_TOKEN;
    }

    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const installments = input.installments ?? 1;
    // Plataforma: usa a selecionada no link (plataformas[0]) → fallback tenantModule → GLOBAL
    const linkPlatformTag = (link as any).plataformas?.[0]?.toUpperCase() ?? null;
    const platformTag = linkPlatformTag ?? owner?.tenantModule?.slug?.toUpperCase() ?? 'GLOBAL';
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
    const fees = isDebit
      ? (() => {
          const d = calculateDebitFees(link, taxaTag);
          return {
            totalAmount: d.baseAmount,       // comprador paga o valor base
            netAmount: d.netAmount,
            domFeeAmount: d.domFeeAmount + d.platformFeeAmount, // total de taxas sobre o vendedor
          };
        })()
      : calculatePaymentLinkFees(link, installments, taxaTag, isPix);
    const { totalAmount, domFeeAmount } = fees;
    let { netAmount } = fees;

    // AREAFLIX: líquido do vendedor = valor − % do método − taxa fixa (taxas do painel)
    const isAfLink = isAreaflixLink({
      webhookUrl: (link as any).webhookUrl,
      plataformas: (link as any).plataformas,
    });
    if (isAfLink) {
      netAmount = calculateAreaflixSellerNet(
        totalAmount,
        isPix ? 'PIX' : isDebit ? 'DEBIT_CARD' : 'CREDIT_CARD',
        installments,
      );
    }

    const result = await this.gateway.chargePaymentLink(domToken, {
      domLinkId: link.domPaymentLinkId,
      amount: totalAmount,
      description: link.description ?? link.title,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: input.customerDocument.replace(/\D/g, ''),
      customerPhone: input.customerPhone.replace(/\D/g, ''),
      paymentMethod: input.paymentMethod ?? 'credit_card',
      installments,
      card: input.card,
    });

    const effectiveUserId = await this.resolveMerchantUserIdByDocument(link.description, link.userId);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: effectiveUserId } });
    if (!wallet) {
      await this.prisma.wallet.create({ data: { userId: effectiveUserId, balance: 0 } });
    }

    const customerDocument = input.customerDocument.replace(/\D/g, '');
    const customerPhone = input.customerPhone.replace(/\D/g, '');

    // totalFee consolidado sempre considera a diferença entre cobrado e líquido.
    const totalFee = totalAmount - netAmount;
    const platformFee = totalFee - domFeeAmount;

    const tx = await this.prisma.transaction.upsert({
      where: { domPaymentId: result.id },
      update: {
        status: this.mapGatewayStatusToTxStatus(result.status),
        paymentMethod: this.mapPaymentMethod(input.paymentMethod),
        amount: new Prisma.Decimal(totalAmount),
        netAmount: new Prisma.Decimal(netAmount),
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(domFeeAmount),
        platformFee: new Prisma.Decimal(platformFee),
        userId: effectiveUserId,
        description: platformTag !== 'GLOBAL' ? `${link.description ?? link.title} [TENANT:${platformTag}]` : (link.description ?? link.title),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument,
        customerPhone,
        paymentLinkId: link.id,
        pixContent: result.pixContent ?? null,
        installments,
      },
      create: {
        userId: effectiveUserId,
        amount: new Prisma.Decimal(totalAmount),
        netAmount: new Prisma.Decimal(netAmount),
        status: this.mapGatewayStatusToTxStatus(result.status),
        paymentMethod: this.mapPaymentMethod(input.paymentMethod),
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(domFeeAmount),
        platformFee: new Prisma.Decimal(platformFee),
        domPaymentId: result.id,
        description: platformTag !== 'GLOBAL' ? `${link.description ?? link.title} [TENANT:${platformTag}]` : (link.description ?? link.title),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument,
        customerPhone,
        paymentLinkId: link.id,
        pixContent: result.pixContent ?? null,
        installments,
      },
    });

    // Cartão aprovado na hora nasce COMPLETED e o webhook DOM não transiciona o status
    // (ver process-dom-webhook: status igual → retorna), então o crédito da wallet é feito aqui.
    if (tx.status === TransactionStatus.COMPLETED) {
      await this.creditWalletForApprovedCharge(tx.id, effectiveUserId, netAmount, tx.description);
    }

    // Incrementa contador de usos
    await this.links.update(link.id, {
      currentUses: ((link as any).currentUses ?? 0) + 1,
    });

    // Cartão aprovado na hora não gera transição de status no webhook DOM —
    // notificar o webhook externo do link (ex: areaflix) aqui. Dedup no
    // receptor via orderId (tx.id).
    if (
      this.mapGatewayStatusToTxStatus(result.status) === TransactionStatus.COMPLETED &&
      (link as any).webhookUrl
    ) {
      void this.notifyExternalWebhook((link as any).webhookUrl as string, {
        event: 'purchase_approved',
        customerEmail: input.customerEmail,
        customerName: input.customerName,
        planName: link.title,
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
      status: result.status ?? 'pending',
      pixContent: result.pixContent ?? null,
      redirectUrl: (link as any).redirectUrl ?? null,
    };
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
