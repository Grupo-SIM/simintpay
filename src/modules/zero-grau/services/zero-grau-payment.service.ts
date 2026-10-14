import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { CheckoutPixDto } from '../../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../../renovada/dtos/checkout-credit-card.dto';
import { TransactionStatus, PaymentMethod } from '@prisma/client';
import dayjs from 'dayjs';
import { ReconcilePendingTransactionsUseCase } from '../../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import { ZeroGrauConfig } from '../zero-grau.config';

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

interface DomPixRequest {
  cod_external: string;
  customer: {
    document: string;
    document_type: string;
    email: string;
    mobile_phone: string;
    name: string;
  };
  items: {
    description: string;
    price: number;
    quantity: number;
  };
  payment: {
    pix: {
      pix_expire: string;
    };
    payment_method: 'pix';
    total: number;
  };
}

interface DomCreditCardRequest {
  cod_external: string;
  customer: {
    document: string;
    document_type: string;
    email: string;
    mobile_phone: string;
    name: string;
  };
  items: {
    description: string;
    price: number;
    quantity: number;
  };
  payment: {
    credit_card: {
      holder_name: string;
      token: string;
      bin: string;
      brand: string;
      installments: number;
      installment_amount: number;
    };
    payment_method: 'credit_card';
    total: number;
  };
}

const ZERO_GRAU_HIDDEN_TAG = '[TENANT:ZERO_GRAU]';

@Injectable()
export class ZeroGrauPaymentService {
  private readonly logger = new Logger(ZeroGrauPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconcile: ReconcilePendingTransactionsUseCase,
  ) {}

  private get domToken(): string | undefined {
    return process.env.ZERO_GRAU_DOM_TOKEN || process.env.DOM_TOKEN;
  }

  private get domOrigin(): string {
    return process.env.ZERO_GRAU_URL_APP || process.env.URL_APP || 'https://api-atlas.jbmidia.com';
  }

  private buildInternalDescription(description: string | null | undefined): string {
    const base = (description ?? '').trim();
    if (!base) return ZERO_GRAU_HIDDEN_TAG;
    if (base.includes(ZERO_GRAU_HIDDEN_TAG)) return base;
    return `${base} ${ZERO_GRAU_HIDDEN_TAG}`;
  }

  /** Reads the `[Unidade - x]` tag the Zero Grau backend embeds in the description. */
  private extractUnit(description: string | null | undefined): string | null {
    const match = (description ?? '').match(/\[Unidade - ([^\]]+)\]/i);
    return match ? match[1].trim() : null;
  }

  async createPaymentPix(userId: string, body: CheckoutPixDto): Promise<any> {
    try {
      this.logger.log(`📱 [ZERO_GRAU] Criando pagamento PIX para usuário ${userId}`, {
        price: body.price,
        document: body.document,
        email: body.email,
        unit: this.extractUnit(body.description),
      });

      if (!body.document || !body.document_type) {
        throw new BadRequestException('Documento e tipo de documento são obrigatórios');
      }
      if (!body.price || body.price <= 0) {
        throw new BadRequestException('Preço deve ser maior que zero');
      }
      if (!body.email || !body.email.includes('@')) {
        throw new BadRequestException('Email inválido');
      }
      if (!body.name || body.name.trim().length < 2) {
        throw new BadRequestException('Nome deve ter pelo menos 2 caracteres');
      }

      const price = body.price;
      const liquidez = ZeroGrauConfig.saque.fatorLiquidez;
      const mdrPix = ZeroGrauConfig.mdr.pix;
      const amountWithoutAllFee = parseFloat((price * liquidez).toFixed(2));
      const totalFees = parseFloat((price * (1 - liquidez)).toFixed(2));
      const domFee = parseFloat((price * mdrPix).toFixed(2));
      const platformFeeCalc = parseFloat((totalFees - domFee).toFixed(2));

      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        throw new BadRequestException('Carteira não encontrada');
      }

      const internalDescription = this.buildInternalDescription(body?.description);

      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          amount: price,
          status: TransactionStatus.DRAFT,
          netAmount: amountWithoutAllFee,
          totalFee: totalFees,
          domFee,
          platformFee: platformFeeCalc,
          paymentMethod: PaymentMethod.PIX,
          description: internalDescription,
          customerName: body?.name,
          customerEmail: body?.email,
          customerDocument: body?.document,
          customerPhone: body?.mobile_phone,
          installments: 1,
        },
      });

      this.logger.log(`✅ [ZERO_GRAU] Transação criada: ${transaction.id}`);

      const paymentRequest: DomPixRequest = {
        cod_external: transaction.id,
        customer: {
          document: body.document.replace(/[.-]/g, ''),
          document_type: body.document_type,
          email: body.email,
          mobile_phone: body.mobile_phone || '',
          name: body.name,
        },
        items: {
          description: body.description || 'Pedido Zero Grau',
          price: price,
          quantity: 1,
        },
        payment: {
          pix: {
            pix_expire: dayjs().add(24, 'hour').format('YYYY-MM-DD HH:mm'),
          },
          payment_method: 'pix',
          total: price,
        },
      };

      this.logger.log('📤 [ZERO_GRAU] Enviando requisição para DOM Pagamentos');
      const payment = await this.createDomPagamentosPix(paymentRequest);
      this.logger.log('📥 [ZERO_GRAU] Resposta do DOM Pagamentos recebida', {
        paymentId: payment.id,
        status: payment.status,
      });

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.PENDING,
          domPaymentId: payment.id,
          pixQrCode: payment.pix_qrcode,
          pixContent: payment.pix_content,
          pixExpire: payment.pix_expire ? new Date(payment.pix_expire) : null,
        },
      });

      this.logger.log(`✅ [ZERO_GRAU] Transação ${transaction.id} atualizada para PENDING`);

      return {
        ...payment,
        transactionId: transaction.id,
        paymentId: payment.id,
        status: 'PENDING',
      };
    } catch (error) {
      this.logger.error('❌ [ZERO_GRAU] Erro ao criar pagamento PIX:', error);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Ocorreu um erro ao processar o pagamento. Por favor, verifique os dados e tente novamente.',
      );
    }
  }

  async createPaymentCreditCard(userId: string, body: CheckoutCreditCardDto): Promise<any> {
    try {
      this.logger.log(`💳 [ZERO_GRAU] Criando pagamento com cartão para usuário ${userId}`, {
        price: body.price,
        installments: body.installments,
        email: body.email,
        unit: this.extractUnit(body.description),
      });

      if (!body.document || !body.document_type) {
        throw new BadRequestException('Documento e tipo de documento são obrigatórios');
      }
      if (!body.price || body.price <= 0) {
        throw new BadRequestException('Preço deve ser maior que zero');
      }

      const price = body.price;
      const liquidezCC = ZeroGrauConfig.saque.fatorLiquidez;
      const mdrCC = ZeroGrauConfig.mdr.cartao[body.installments] ?? ZeroGrauConfig.mdr.cartao[1];
      const amountWithoutAllFee = parseFloat((price * liquidezCC).toFixed(2));
      const totalFeesFinal = parseFloat((price * (1 - liquidezCC)).toFixed(2));
      const domFee = parseFloat((price * mdrCC).toFixed(2));
      const platformFeeCC = parseFloat((totalFeesFinal - domFee).toFixed(2));

      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        throw new BadRequestException('Carteira não encontrada');
      }

      const internalDescription = this.buildInternalDescription(body?.description);

      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          amount: price,
          status: TransactionStatus.DRAFT,
          netAmount: amountWithoutAllFee,
          totalFee: totalFeesFinal,
          domFee,
          platformFee: platformFeeCC,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          description: internalDescription,
          customerName: body?.name,
          customerEmail: body?.email,
          customerDocument: body?.document,
          customerPhone: body?.mobile_phone,
          installments: body.installments,
          cardBrand: body.brand,
          cardBin: body.bin,
        },
      });

      this.logger.log(`✅ [ZERO_GRAU] Transação criada: ${transaction.id}`);

      const installmentAmount = price / body.installments;

      const paymentRequest: DomCreditCardRequest = {
        cod_external: transaction.id,
        customer: {
          document: body.document.replace(/[.-]/g, ''),
          document_type: body.document_type,
          email: body.email,
          mobile_phone: body.mobile_phone || '',
          name: body.name,
        },
        items: {
          description: body.description || 'Pedido Zero Grau',
          price: price,
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
      };

      this.logger.log('📤 [ZERO_GRAU] Enviando requisição para DOM Pagamentos');
      const payment = await this.createDomPagamentosCreditCard(paymentRequest);
      this.logger.log('📥 [ZERO_GRAU] Resposta do DOM Pagamentos recebida', {
        paymentId: payment.id,
        status: payment.status,
      });

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.PENDING,
          domPaymentId: payment.id,
        },
      });

      this.logger.log(`✅ [ZERO_GRAU] Transação ${transaction.id} atualizada para PENDING`);

      // Persist terminal gateway results through the same idempotent webhook path.
      // Returning the stored status prevents Delivery from confirming before SimIntPay.
      let status = 'PENDING';
      if (!['pending', 'pending_capture'].includes(payment.status?.trim().toLowerCase())) {
        try {
          const settled = await this.reconcile.reconcilePayment(payment.id, userId, this.domToken);
          if (settled.status !== 'NOT_FOUND') status = settled.status;
        } catch (error) {
          // Charge already exists: preserve its reference so polling can retry settlement.
          this.logger.error(`[ZERO_GRAU][card] Settlement failed paymentId=${payment.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return {
        ...payment,
        transactionId: transaction.id,
        paymentId: payment.id,
        status,
        fee_details: {
          installment_amount: installmentAmount,
          total_fee: totalFeesFinal,
          total_amount: price,
          net_amount_seller: amountWithoutAllFee,
        },
      };
    } catch (error) {
      this.logger.error('❌ [ZERO_GRAU] Erro ao criar pagamento com cartão:', error);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Ocorreu um erro ao processar o pagamento. Por favor, verifique os dados e tente novamente.',
      );
    }
  }

  private async createDomPagamentosPix(request: DomPixRequest): Promise<DomPagamentosResponse> {
    const url = 'https://apiv3.dompagamentos.com.br/checkout/production/transactions';
    const headers = {
      Authorization: `Bearer ${this.domToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
      Origin: this.domOrigin,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      const responseData = await response.json();

      if (!response.ok) {
        this.logger.error('[ZERO_GRAU] Erro do DOM Pagamentos (PIX):', {
          status: response.status,
          response: responseData,
        });

        let errorMessage = 'Erro ao processar pagamento PIX';
        switch (response.status) {
          case 400: errorMessage = responseData.message || 'Parâmetros de requisição inválidos'; break;
          case 401: errorMessage = 'Credenciais de API inválidas'; break;
          case 422: errorMessage = 'Dados de pagamento inválidos'; break;
          case 429: errorMessage = 'Muitas requisições, tente novamente mais tarde'; break;
          case 500: case 502: case 503: errorMessage = 'Serviço de pagamento temporariamente indisponível'; break;
        }

        throw new BadRequestException(errorMessage);
      }

      this.logger.log('✅ [ZERO_GRAU] Sucesso no DOM Pagamentos (PIX)', {
        id: responseData.id,
        status: responseData.status,
      });

      return responseData as DomPagamentosResponse;
    } catch (error) {
      this.logger.error('[ZERO_GRAU] Erro na comunicação com DOM Pagamentos (PIX):', error);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Erro ao comunicar com o serviço de pagamento. Por favor, tente novamente mais tarde.',
      );
    }
  }

  private async createDomPagamentosCreditCard(request: DomCreditCardRequest): Promise<DomPagamentosResponse> {
    const url = 'https://apiv3.dompagamentos.com.br/checkout/production/transactions';
    const headers = {
      Authorization: `Bearer ${this.domToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
      Origin: this.domOrigin,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      const responseData = await response.json();

      if (!response.ok) {
        this.logger.error('[ZERO_GRAU] Erro do DOM Pagamentos (Cartão):', {
          status: response.status,
          response: responseData,
        });

        let errorMessage = 'Erro ao processar pagamento com cartão';
        switch (response.status) {
          case 400: errorMessage = responseData.message || 'Parâmetros de requisição inválidos'; break;
          case 401: errorMessage = 'Credenciais de API inválidas'; break;
          case 422: errorMessage = 'Dados de cartão inválidos'; break;
          case 429: errorMessage = 'Muitas requisições, tente novamente mais tarde'; break;
          case 500: case 502: case 503: errorMessage = 'Serviço de pagamento temporariamente indisponível'; break;
        }

        throw new BadRequestException(errorMessage);
      }

      this.logger.log('✅ [ZERO_GRAU] Sucesso no DOM Pagamentos (Cartão)', {
        id: responseData.id,
        status: responseData.status,
      });

      return responseData as DomPagamentosResponse;
    } catch (error) {
      this.logger.error('[ZERO_GRAU] Erro na comunicação com DOM Pagamentos (Cartão):', error);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Erro ao comunicar com o serviço de pagamento. Por favor, tente novamente mais tarde.',
      );
    }
  }

  async checkPixStatusDirect(domPaymentId: string): Promise<{ status: string }> {
    const userId = process.env.ZERO_GRAU_USER_ID?.trim();
    if (!userId) return { status: 'UNKNOWN' };
    const result = await this.reconcile.reconcilePayment(domPaymentId, userId, this.domToken);
    return { status: result.status };
  }
}
