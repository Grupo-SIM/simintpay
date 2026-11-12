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

export type ChargeBoletoInput = {
  boletoId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone?: string;
  tracking?: Record<string, string>;
  documentType?: 'CPF' | 'CNPJ';
  // Endereço do pagador (obrigatório para boleto).
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  complemento?: string;
};

@Injectable()
export class ChargeBoletoUseCase {
  constructor(
    @Inject(BOLETO_REPOSITORY) private readonly boletos: IBoletoRepository,
    @Inject(USER_REPOSITORY) _users: IUserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: ChargeBoletoInput): Promise<{
    id: string;
    transactionId: string;
    status: string;
    boletoUrl: string | null;
    barcode: string | null;
    digitableLine: string | null;
    dueDate: string | null;
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
    const codExternal = `boleto-${boleto.id}-${Date.now()}`;
    const base = Number(boleto.amount);

    // Endereço é obrigatório para boleto — a DOM recusa sem street/cidade/uf/cep.
    const rua = (input.rua ?? '').trim();
    const cep = (input.cep ?? '').replace(/\D/g, '');
    const cidade = (input.cidade ?? '').trim();
    const uf = (input.uf ?? '').trim();
    const bairro = (input.bairro ?? '').trim();
    const numero = (input.numero ?? '').trim();
    if (!rua || !cidade || uf.length !== 2 || cep.length !== 8) {
      throw new BadRequestException(
        'Para boleto é obrigatório o endereço completo (CEP, rua, número, bairro, cidade e UF).',
      );
    }

    const platformTag =
      (boleto.plataformas?.[0] as string | undefined)?.toUpperCase() ||
      'GLOBAL';
    const financialContext = await loadChargePolicy(
      this.prisma,
      platformTag,
      undefined,
      boleto.userId,
    );
    const financialQuote = quoteFinancialCharge(
      financialContext,
      base,
      'BOLETO',
    );
    if (!financialQuote)
      throw new BadRequestException({ code: 'FINANCIAL_POLICY_MISSING' });
    const fees = financialQuote;
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
      netAmount: new Prisma.Decimal(fees.netAmount),
      paymentMethod: PaymentMethod.BOLETO,
      totalFee: new Prisma.Decimal(fees.totalFeeAmount),
      acquirerFee: new Prisma.Decimal(fees.domFeeAmount),
      platformFee: new Prisma.Decimal(fees.platformProfit),
      description:
        platformTag !== 'GLOBAL'
          ? `${boleto.description ?? boleto.title} [TENANT:${platformTag}]`
          : (boleto.description ?? boleto.title),
      ...transactionPlatformTagData(platformTag),
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: document,
      customerPhone: phone || null,
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

    const result = await discardDraftOnRejection(this.prisma, chargeId, () =>
      this.gateway.chargeBoletoForLink(domToken, {
        cashbackDisabled: !financialContext.cashbackActive,
        amount: financialQuote.totalAmount,
        description: `${snapshot.description} [LINK_CHARGE:${chargeId}]`,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: document,
        customerPhone: phone,
        documentType,
        codExternal,
        expireDays: boleto.vencimentoDias,
        address: {
          street: rua,
          number: numero || 'S/N',
          neighborhood: bairro,
          zipCode: cep,
          city: cidade,
          uf,
          complement: (input.complemento ?? '').trim(),
        },
      }),
    );

    // Se a DOM não gerou o boleto (status failed ou sem link/linha digitável), não
    // salva transação órfã e devolve erro claro para o checkout exibir.
    const boletoFalhou =
      String(result.status ?? '').toLowerCase() === 'failed' ||
      (!result.boletoUrl && !result.digitableLine);
    if (boletoFalhou) {
      throw new BadRequestException(
        'Não foi possível gerar o boleto no gateway. Verifique os dados e tente novamente.',
      );
    }

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
        { ...snapshot, domPaymentId: result.id },
        TransactionStatus.PENDING,
        chargeId,
      ),
    );

    await this.boletos.update(boleto.id, {
      currentUses: boleto.currentUses + 1,
    });

    return {
      id: result.id,
      transactionId: savedTx.id,
      status: result.status,
      boletoUrl: result.boletoUrl,
      barcode: result.barcode,
      digitableLine: result.digitableLine,
      dueDate: result.dueDate,
      amount: financialQuote.totalAmount,
    };
  }
}
