import { transactionPlatformTagData } from '../../../modules/platform-core/transaction-platform';
import {
  captureCoproduction,
  withCoproduction,
} from '../../../modules/coproduction/coproduction.service';
import { randomUUID } from 'node:crypto';
import { persistLinkCharge } from '../../../modules/platform-core/link-settlement';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../../../modules/financial-policy/financial-charge';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { discardDraftOnRejection } from '../../../modules/unified-platform/payments/dom-rejection';
import { paymentTracking } from '../../../modules/platform-core/payment-tracking';

export type ChargeBoletoPixInput = {
  boletoId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone?: string;
  documentType?: 'CPF' | 'CNPJ';
  tracking?: Record<string, string>;
};

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
    if (
      boleto.expiresAt &&
      new Date(boleto.expiresAt).getTime() <= Date.now()
    ) {
      throw new NotFoundException('Boleto expirado');
    }
    if (boleto.maxUses != null && boleto.currentUses >= boleto.maxUses) {
      throw new BadRequestException('Limite de usos do boleto atingido');
    }
    if (!boleto.domPaymentLinkId) {
      throw new BadRequestException(
        'Boleto ainda não sincronizado com o gateway',
      );
    }

    const domToken = platformGatewayToken(
      boleto.plataformas?.[0],
      process.env.DOM_TOKEN,
    );
    if (!domToken)
      throw new BadRequestException('Token do gateway não configurado');

    const document = input.customerDocument.replace(/\D/g, '');
    const documentType =
      input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF');
    const phone = (input.customerPhone ?? '').replace(/\D/g, '');
    const codExternal = `pix-boleto-${boleto.id}-${Date.now()}`;
    const base = Number(boleto.amount);

    const platformTag =
      (boleto.plataformas?.[0] as string | undefined)?.toUpperCase() ||
      'GLOBAL';
    const financialContext = await loadChargePolicy(
      this.prisma,
      platformTag,
      undefined,
      boleto.userId,
    );
    const financialQuote = quoteFinancialCharge(financialContext, base, 'PIX');
    if (!financialQuote) {
      throw new BadRequestException(
        'Taxas da plataforma não configuradas para esta modalidade',
      );
    }
    const {
      netAmount,
      domFeeAmount,
      totalFeeAmount: totalFee,
    } = financialQuote;
    const chargeId = randomUUID();
    const coproduction = await captureCoproduction(
      this.prisma,
      'boletos',
      boleto.id,
      boleto.userId,
      platformTag,
    );
    const snapshot = {
      userId: boleto.userId,
      amount: new Prisma.Decimal(financialQuote.totalAmount),
      netAmount: new Prisma.Decimal(netAmount),
      totalFee: new Prisma.Decimal(totalFee),
      domFee: new Prisma.Decimal(domFeeAmount),
      platformFee: new Prisma.Decimal(financialQuote.platformProfit),
      paymentMethod: PaymentMethod.PIX,
      description: `${boleto.title} [TENANT:${platformTag}]`,
      ...transactionPlatformTagData(platformTag),
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: document,
      customerPhone: phone,
      tracking: paymentTracking(input.tracking),
      financialSnapshot: withCoproduction(
        financialQuote.financialSnapshot,
        coproduction,
      ),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.upsert({
        where: { userId: boleto.userId },
        update: {},
        create: { userId: boleto.userId, balance: 0 },
      });
      await tx.transaction.create({
        data: {
          ...snapshot,
          id: chargeId,
          status: 'DRAFT',
          settlementBasis: 'FINAL_NET',
        },
      });
    });

    const domLinkId = boleto.domPaymentLinkId;
    const result = await discardDraftOnRejection(this.prisma, chargeId, () =>
      this.gateway.chargePixForLink(domToken, {
        cashbackDisabled: !financialContext.cashbackActive,
        domLinkId,
        amount: financialQuote.totalAmount,
        description: `${snapshot.description} [LINK_CHARGE:${chargeId}]`,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone,
        documentType,
        codExternal,
      }),
    );

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: boleto.userId },
    });
    if (!wallet) {
      await this.prisma.wallet.create({
        data: { userId: boleto.userId, balance: 0 },
      });
    }

    const savedTx = await this.prisma.$transaction((tx) =>
      persistLinkCharge(
        tx,
        {
          ...snapshot,
          domPaymentId: result.id,
          pixContent: result.pixContent ?? null,
        },
        TransactionStatus.PENDING,
        chargeId,
      ),
    );

    await this.boletos.update(boleto.id, {
      currentUses: boleto.currentUses + 1,
    });

    return {
      ...result,
      transactionId: savedTx.id,
      amount: financialQuote.totalAmount,
    };
  }
}
