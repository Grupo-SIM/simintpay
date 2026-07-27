import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { getModuleDomToken } from '../../../modules/module.registry';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { clientTaxaTagFor } from '../../helpers/client-rules.helper';
import { buildClientTaxaTag, getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

export type ChargeBoletoPixInput = {
  boletoId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone?: string;
  documentType?: 'CPF' | 'CNPJ';
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

@Injectable()
export class ChargeBoletoPixUseCase {
  constructor(
    @Inject(BOLETO_REPOSITORY) private readonly boletos: IBoletoRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: ChargeBoletoPixInput): Promise<{
    id: string;
    transactionId: string;
    status: string;
    pixContent: string | null;
    qrCode: string | null;
    pixExpire: string | null;
    amount: number;
  }> {
    const boleto = await this.boletos.findById(input.boletoId);
    if (!boleto || !boleto.isActive) {
      throw new NotFoundException('Boleto não encontrado ou inativo');
    }
    if (boleto.expiresAt && new Date(boleto.expiresAt).getTime() <= Date.now()) {
      throw new NotFoundException('Boleto expirado');
    }
    if (boleto.maxUses != null && boleto.currentUses >= boleto.maxUses) {
      throw new BadRequestException('Limite de usos do boleto atingido');
    }
    if (!boleto.domPaymentLinkId) {
      throw new BadRequestException('Boleto ainda não sincronizado com o gateway');
    }

    const owner = await this.users.findById(boleto.userId);
    const ownerClientTag = clientTaxaTagFor(owner);

    let domToken: string | null | undefined = ownerClientTag ? process.env.DOM_TOKEN : owner?.domToken;
    if (!domToken && !ownerClientTag && owner?.tenantModule?.slug) {
      domToken = getModuleDomToken(owner.tenantModule.slug);
    }
    if (!domToken) domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new BadRequestException('Token do gateway não configurado');

    const document = input.customerDocument.replace(/\D/g, '');
    const documentType = input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF');
    const phone = (input.customerPhone ?? '').replace(/\D/g, '');
    const codExternal = `pix-boleto-${boleto.id}-${Date.now()}`;
    const base = Number(boleto.amount);

    const platformTag = (boleto.plataformas?.[0] as string | undefined)?.toUpperCase()
      || owner?.tenantModule?.slug?.toUpperCase()
      || 'GLOBAL';
    const taxaTag = ownerClientTag
      ?? (platformTag === 'GLOBAL' && input.customerEmail?.trim()
        ? buildClientTaxaTag(input.customerEmail)
        : platformTag);

    // PIX à vista: comprador paga o valor base; vendedor arca com a taxa PIX (igual link).
    const sellerFeePct = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
    const sellerFeeFixed = getPlatformTaxaEffective(taxaTag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
    const cashback = getPlatformTaxaEffective(taxaTag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const transFixed = getPlatformTaxaEffective(taxaTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const netAmount = round2(base - (base * sellerFeePct + sellerFeeFixed) - cashback - transFixed);
    const totalFee = round2(base - netAmount);

    const result = await this.gateway.chargePixForLink(domToken, {
      domLinkId: boleto.domPaymentLinkId,
      amount: base,
      description: boleto.title,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: document,
      customerPhone: phone,
      documentType,
      codExternal,
    });

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: boleto.userId } });
    if (!wallet) {
      await this.prisma.wallet.create({ data: { userId: boleto.userId, balance: 0 } });
    }

    const savedTx = await this.prisma.transaction.upsert({
      where: { domPaymentId: result.id },
      update: {
        status: TransactionStatus.PENDING,
        paymentMethod: PaymentMethod.PIX,
        amount: new Prisma.Decimal(base),
        netAmount: new Prisma.Decimal(netAmount),
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(0),
        platformFee: new Prisma.Decimal(totalFee),
        userId: boleto.userId,
        description: platformTag !== 'GLOBAL' ? `${boleto.description ?? boleto.title} [TENANT:${platformTag}]` : (boleto.description ?? boleto.title),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone || null,
        pixContent: result.pixContent ?? null,
      },
      create: {
        userId: boleto.userId,
        amount: new Prisma.Decimal(base),
        netAmount: new Prisma.Decimal(netAmount),
        status: TransactionStatus.PENDING,
        paymentMethod: PaymentMethod.PIX,
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(0),
        platformFee: new Prisma.Decimal(totalFee),
        domPaymentId: result.id,
        description: platformTag !== 'GLOBAL' ? `${boleto.description ?? boleto.title} [TENANT:${platformTag}]` : (boleto.description ?? boleto.title),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone || null,
        pixContent: result.pixContent ?? null,
      },
    });

    await this.boletos.update(boleto.id, { currentUses: boleto.currentUses + 1 });

    return {
      ...result,
      transactionId: savedTx.id,
      amount: base,
    };
  }
}
