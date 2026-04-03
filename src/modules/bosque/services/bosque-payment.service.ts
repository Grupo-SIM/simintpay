import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { BosqueConfig } from '../bosque.config';
import { CheckoutPixDto } from '../dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../dtos/checkout-credit-card.dto';
import { TransactionStatus, PaymentMethod } from '@prisma/client';
import dayjs from 'dayjs';

interface DomPagamentosResponse {
  id: string;
  status: string;
  pix_qrcode?: string;
  pix_content?: string;
  pix_expire?: string;
  message?: string;
  payment_info?: {
    installment_amount: number;
    total_amount: number;
    authorization_code?: string;
    nsu?: string;
    tid?: string;
  };
}

const BOSQUE_HIDDEN_TAG = '[TENANT:BOSQUE]';

@Injectable()
export class BosquePaymentService {
  private readonly logger = new Logger(BosquePaymentService.name);
  private readonly DOM_URL = 'https://apiv3.dompagamentos.com.br/checkout/production/transactions';

  constructor(private readonly prisma: PrismaService) {}

  private buildInternalDescription(description: string | null | undefined): string {
    const base = (description ?? '').trim();
    if (!base) return BOSQUE_HIDDEN_TAG;
    if (base.includes(BOSQUE_HIDDEN_TAG)) return base;
    return `${base} ${BOSQUE_HIDDEN_TAG}`;
  }

  private get domToken(): string {
    return process.env.DOM_TOKEN ?? '';
  }

  async createPaymentPix(userId: string, body: CheckoutPixDto): Promise<any> {
    try {
      this.logger.log(`[BOSQUE] Criando pagamento PIX para usuário ${userId}`);

      if (!body.document || !body.document_type)
        throw new BadRequestException('Documento e tipo de documento são obrigatórios');
      if (!body.price || body.price <= 0)
        throw new BadRequestException('Preço deve ser maior que zero');
      if (!body.email || !body.email.includes('@'))
        throw new BadRequestException('Email inválido');
      if (!body.name || body.name.trim().length < 2)
        throw new BadRequestException('Nome deve ter pelo menos 2 caracteres');

      const price = body.price;
      const liquidez = BosqueConfig.saque.fatorLiquidez;
      const mdrPix = BosqueConfig.mdr.pix;
      const taxaFixa = BosqueConfig.mdr.taxaFixaPorTransacao;
      const cashbackRate = BosqueConfig.mdr.taxaCashback ?? 0;

      const calcLiquidez = price * liquidez;
      const calcCashback = price * (cashbackRate / 100);
      let netAmount = parseFloat((calcLiquidez - taxaFixa - calcCashback).toFixed(2));
      if (netAmount < 0) netAmount = 0;

      const totalFee = parseFloat((price - netAmount).toFixed(2));
      const domFee = parseFloat((price * mdrPix).toFixed(2));
      const platformFee = parseFloat((totalFee - domFee).toFixed(2));

      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new BadRequestException('Carteira não encontrada');
      const internalDescription = this.buildInternalDescription(body.description);

      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          amount: price,
          status: TransactionStatus.DRAFT,
          netAmount,
          totalFee,
          domFee,
          platformFee,
          paymentMethod: PaymentMethod.PIX,
          description: internalDescription,
          customerName: body.name,
          customerEmail: body.email,
          customerDocument: body.document,
          customerPhone: body.mobile_phone,
          installments: 1,
        },
      });

      const response = await fetch(this.DOM_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.domToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
          Origin: 'https://simpay-back.simintermediacoes.com',
        },
        body: JSON.stringify({
          cod_external: transaction.id,
          customer: {
            document: body.document.replace(/[.-]/g, ''),
            document_type: body.document_type,
            email: body.email,
            mobile_phone: body.mobile_phone || '',
            name: body.name,
          },
          items: {
            description: body.description || 'Pagamento PIX',
            price,
            quantity: 1,
          },
          payment: {
            pix: { pix_expire: dayjs().add(24, 'hour').format('YYYY-MM-DD HH:mm') },
            payment_method: 'pix',
            total: price,
          },
        }),
      });

      const data = (await response.json()) as DomPagamentosResponse;

      if (!response.ok) {
        this.logger.error('[BOSQUE] Erro DOM Pagamentos (PIX):', { status: response.status, data });
        throw new BadRequestException(data.message || 'Erro ao processar pagamento PIX');
      }

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.PENDING,
          domPaymentId: data.id,
          pixQrCode: data.pix_qrcode,
          pixContent: data.pix_content,
          pixExpire: data.pix_expire ? new Date(data.pix_expire) : null,
        },
      });

      return { ...data, transactionId: transaction.id, paymentId: data.id, status: 'PENDING' };
    } catch (error) {
      this.logger.error('[BOSQUE] Erro ao criar pagamento PIX:', error);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Erro ao processar o pagamento. Tente novamente.');
    }
  }

  async createPaymentCreditCard(userId: string, body: CheckoutCreditCardDto): Promise<any> {
    try {
      this.logger.log(`[BOSQUE] Criando pagamento cartão para usuário ${userId}`);

      if (!body.document || !body.document_type)
        throw new BadRequestException('Documento e tipo de documento são obrigatórios');
      if (!body.price || body.price <= 0)
        throw new BadRequestException('Preço deve ser maior que zero');

      const price = body.price;
      const installments = body.installments ?? 1;
      const rate = BosqueConfig.mdr.cartao[installments] ?? BosqueConfig.mdr.cartao[1];
      const liquidezCC = BosqueConfig.saque.fatorLiquidez;
      const taxaFixa = BosqueConfig.mdr.taxaFixaPorTransacao;
      const cashbackRate = BosqueConfig.mdr.taxaCashback ?? 0;

      const calcLiquidezCC = price * liquidezCC;
      const calcCashbackCC = price * (cashbackRate / 100);
      let netAmount = parseFloat((calcLiquidezCC - taxaFixa - calcCashbackCC).toFixed(2));
      if (netAmount < 0) netAmount = 0;

      const totalFeeCC = parseFloat((price - netAmount).toFixed(2));
      const domFeeCC = parseFloat((price * rate).toFixed(2));
      const platformFeeCC = parseFloat((totalFeeCC - domFeeCC).toFixed(2));

      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new BadRequestException('Carteira não encontrada');
      const internalDescription = this.buildInternalDescription(body.description);

      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          amount: price,
          status: TransactionStatus.DRAFT,
          netAmount,
          totalFee: totalFeeCC,
          domFee: domFeeCC,
          platformFee: platformFeeCC,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          description: internalDescription,
          customerName: body.name,
          customerEmail: body.email,
          customerDocument: body.document,
          customerPhone: body.mobile_phone,
          installments: body.installments,
          cardBrand: body.brand,
          cardBin: body.bin,
        },
      });

      const installmentAmount = price / body.installments;

      const response = await fetch(this.DOM_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.domToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
          Origin: 'https://simpay-back.simintermediacoes.com',
        },
        body: JSON.stringify({
          cod_external: transaction.id,
          customer: {
            document: body.document.replace(/[.-]/g, ''),
            document_type: body.document_type,
            email: body.email,
            mobile_phone: body.mobile_phone || '',
            name: body.name,
          },
          items: {
            description: body.description || 'Pagamento com Cartão',
            price,
            quantity: 1,
          },
          payment: {
            credit_card: {
              holder_name: body.holder_name,
              token: body.token,
              bin: body.bin,
              brand: body.brand,
              installments: body.installments,
              installment_amount: installmentAmount,
            },
            payment_method: 'credit_card',
            total: price,
          },
        }),
      });

      const data = (await response.json()) as DomPagamentosResponse;

      if (!response.ok) {
        this.logger.error('[BOSQUE] Erro DOM Pagamentos (Cartão):', { status: response.status, data });
        throw new BadRequestException(data.message || 'Erro ao processar pagamento com cartão');
      }

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.PENDING, domPaymentId: data.id },
      });

      return {
        ...data,
        transactionId: transaction.id,
        paymentId: data.id,
        status: 'PENDING',
        fee_details: {
          installment_amount: installmentAmount,
          total_fee: domFeeCC,
          total_amount: price,
          net_amount_seller: netAmount,
        },
      };
    } catch (error) {
      this.logger.error('[BOSQUE] Erro ao criar pagamento cartão:', error);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Erro ao processar o pagamento. Tente novamente.');
    }
  }
}
