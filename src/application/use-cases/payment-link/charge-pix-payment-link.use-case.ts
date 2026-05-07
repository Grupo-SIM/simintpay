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

export type ChargePixPaymentLinkInput = {
  linkId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone?: string;
  documentType?: 'CPF' | 'CNPJ';
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
    if ((link as any).maxUses != null && (link as any).currentUses >= (link as any).maxUses) {
      throw new BadRequestException('Limite de usos do link atingido');
    }
    if (!link.domPaymentLinkId) {
      throw new BadRequestException('Link ainda não sincronizado com o gateway');
    }
    if (!link.aceitaPix) {
      throw new BadRequestException('Este link não aceita pagamento via PIX');
    }

    const owner = await this.users.findById(link.userId);
    let domToken: string | null | undefined = owner?.domToken;

    if (!domToken && owner?.tenantModule?.slug) {
      domToken = getModuleDomToken(owner.tenantModule.slug);
    }

    if (!domToken) domToken = process.env.DOM_TOKEN;

    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const document = input.customerDocument.replace(/\D/g, '');
    const documentType = input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF');
    const phone = (input.customerPhone ?? '').replace(/\D/g, '');
    const codExternal = `pix-link-${link.id}-${Date.now()}`;

    // PIX é sempre 1 parcela sem juros — comprador paga exatamente o valor base do link
    const platformTag = owner?.tenantModule?.slug?.toUpperCase() ?? 'GLOBAL';
    const fees = calculatePaymentLinkFees(link, 1, platformTag, true);
    const { totalAmount, netAmount, domFeeAmount } = fees;

    const result = await this.gateway.chargePixForLink(domToken, {
      domLinkId: link.domPaymentLinkId,
      amount: totalAmount,
      description: link.title,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: document,
      customerPhone: phone,
      documentType,
      codExternal,
    });

    const effectiveUserId = await this.resolveMerchantUserIdByDocument(link.description, link.userId);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: effectiveUserId } });
    if (!wallet) {
      await this.prisma.wallet.create({ data: { userId: effectiveUserId, balance: 0 } });
    }

    const totalFee = totalAmount - netAmount;
    const platformFee = totalFee - domFeeAmount;

    const savedTx = await this.prisma.transaction.upsert({
      where: { domPaymentId: result.id },
      update: {
        status: TransactionStatus.PENDING,
        paymentMethod: PaymentMethod.PIX,
        amount: new Prisma.Decimal(totalAmount),
        netAmount: new Prisma.Decimal(netAmount),
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(domFeeAmount),
        platformFee: new Prisma.Decimal(platformFee),
        userId: effectiveUserId,
        description: link.description ?? link.title,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone || null,
        paymentLinkId: link.id,
        pixContent: result.pixContent ?? null,
      },
      create: {
        userId: effectiveUserId,
        amount: new Prisma.Decimal(totalAmount),
        netAmount: new Prisma.Decimal(netAmount),
        status: TransactionStatus.PENDING,
        paymentMethod: PaymentMethod.PIX,
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(domFeeAmount),
        platformFee: new Prisma.Decimal(platformFee),
        domPaymentId: result.id,
        description: link.description ?? link.title,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone || null,
        paymentLinkId: link.id,
        pixContent: result.pixContent ?? null,
      },
    });

    // Incrementa contador de usos
    await this.links.update(link.id, {
      currentUses: ((link as any).currentUses ?? 0) + 1,
    });

    return {
      ...result,
      transactionId: savedTx.id,
      amount: totalAmount,
    };
  }
}
