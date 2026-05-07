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

    // Resolve domToken: usuário individual > módulo > DOM_TOKEN global
    const owner = await this.users.findById(link.userId);
    let domToken: string | null | undefined = owner?.domToken;

    if (!domToken && owner?.tenantModule?.slug) {
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
    const isDebit = input.paymentMethod === 'debit_card';
    const isPix = input.paymentMethod === 'pix';

    // Para débito: comprador paga valor base; taxas (DOM 3,49%+R$1 + plataforma) saem do líquido do vendedor.
    // Para PIX: comprador paga exatamente o valor base, sem juros de parcelamento.
    // Para crédito: cálculo normal com juros repassados ao comprador.
    const fees = isDebit
      ? (() => {
          const d = calculateDebitFees(link, platformTag);
          return {
            totalAmount: d.baseAmount,       // comprador paga o valor base
            netAmount: d.netAmount,
            domFeeAmount: d.domFeeAmount + d.platformFeeAmount, // total de taxas sobre o vendedor
          };
        })()
      : calculatePaymentLinkFees(link, installments, platformTag, isPix);
    const { totalAmount, netAmount, domFeeAmount } = fees;

    const result = await this.gateway.chargePaymentLink(domToken, {
      domLinkId: link.domPaymentLinkId,
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

    await this.prisma.transaction.upsert({
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
        description: link.description ?? link.title,
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
        description: link.description ?? link.title,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument,
        customerPhone,
        paymentLinkId: link.id,
        pixContent: result.pixContent ?? null,
        installments,
      },
    });

    // Incrementa contador de usos
    await this.links.update(link.id, {
      currentUses: ((link as any).currentUses ?? 0) + 1,
    });

    return {
      id: result.id,
      status: result.status ?? 'pending',
      pixContent: result.pixContent ?? null,
      redirectUrl: null,
    };
  }
}
