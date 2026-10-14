import { getPlatformOwnerId } from '../../module.registry';
import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { CheckoutPixDto } from '../../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../../renovada/dtos/checkout-credit-card.dto';
import { TransactionStatus, PaymentMethod } from '@prisma/client';
import dayjs from 'dayjs';
import { ReconcilePendingTransactionsUseCase } from '../../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import type { ModuleConfig } from '../../module-config.interface';
import { UnprocessableEntityException, ForbiddenException, NotFoundException } from '@nestjs/common';

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



@Injectable()
export class LegacyPlatformPaymentCore {
  private readonly logger = new Logger(LegacyPlatformPaymentCore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconcile: ReconcilePendingTransactionsUseCase | undefined,
    private readonly tag: string,
    private readonly config: ModuleConfig,
    private readonly merchantId?: string,
  ) {}

  protected get domToken(): string | undefined {
    return (getPlatformIntegrationValue(this.tag, 'DOM_TOKEN') ?? undefined);
  }


  private get hiddenTag(): string { return `[TENANT:${this.tag.replaceAll('-', '_')}]`; }

  protected productDescription(description?: string | null): string {
    return description?.trim() || (this.tag === 'ATLAS' ? 'HOSTING Compra Atlas Hosting' : 'Pagamento PIX');
  }

  private async assertPlatformOwner(userId: string): Promise<void> {
    const platform = await this.prisma.platform.findUnique({ where: { tag: this.tag }, include: { owner: true } });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (!platform.isActive || !platform.owner.isActive || platform.owner.isPurged) throw new ForbiddenException('Plataforma ou dono indisponível');
    if (this.merchantId) {
      const merchant = await this.prisma.integrationMerchant.findUnique({ where: { id: this.merchantId }, include: { user: true } });
      const binding = await this.prisma.platformIntegration.findUnique({ where: { platformId_key: { platformId: platform.id, key: 'LEGACY_MERCHANT_KEYS' } } });
      if (!merchant?.user.isActive || merchant.user.isPurged || merchant.userId !== userId || !binding?.url?.split(',').map(key => key.trim()).includes(merchant.integrationKey)) throw new ForbiddenException('Comerciante fora da plataforma');
    } else if (platform.ownerUserId !== userId) throw new ForbiddenException('Plataforma pertence a outro dono');
    if (platform.acquirer !== 'DOM') throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'legacy.dom-checkout' });
  }

  private get domOrigin(): string {
    return (getPlatformIntegrationValue(this.tag, 'URL_APP') ?? undefined) || '';
  }

  private buildInternalDescription(description: string | null | undefined): string {
    const base = (description ?? '').trim();
    if (!base) return this.hiddenTag;
    if (base.includes(this.hiddenTag)) return base;
    return `${base} ${this.hiddenTag}`;
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

      await this.assertPlatformOwner(userId);
      const price = body.price;
      const liquidez = this.config.saque.fatorLiquidez;
      const mdrPix = this.config.mdr.pix;
      const amountWithoutAllFee = parseFloat((price * liquidez).toFixed(2));
      const totalFees = parseFloat((this.tag === 'BOSQUE' || this.tag === 'RENOVADA' ? price - amountWithoutAllFee : price * (1 - liquidez)).toFixed(2));
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
          description: this.productDescription(body.description),
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
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
      throw new BadRequestException(
        'Ocorreu um erro ao processar o pagamento. Por favor, verifique os dados e tente novamente.',
      );
    }
  }

  async createPaymentCreditCard(userId: string, body: CheckoutCreditCardDto): Promise<any> {
    try {
      if (this.tag === 'BOSQUE') body = { ...body, installments: body.installments ?? 1 };
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

      await this.assertPlatformOwner(userId);
      const price = body.price;
      const liquidezCC = this.config.saque.fatorLiquidez;
      const mdrCC = this.config.mdr.cartao[body.installments] ?? this.config.mdr.cartao[1];
      const amountWithoutAllFee = parseFloat((price * liquidezCC).toFixed(2));
      const totalFeesFinal = parseFloat((this.tag === 'BOSQUE' || this.tag === 'RENOVADA' ? price - amountWithoutAllFee : price * (1 - liquidezCC)).toFixed(2));
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
          description: this.productDescription(body.description),
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

      const gatewayStatus = String(payment.status ?? '').toLowerCase();
      if (this.tag === 'ATLAS' && ['not_authorized', 'error', 'failed', 'refused', 'canceled', 'expired'].includes(gatewayStatus)) {
        await this.prisma.transaction.update({ where: { id: transaction.id }, data: { status: TransactionStatus.FAILED, domPaymentId: payment.id } });
        throw new BadRequestException('O pagamento não foi autorizado pela operadora do cartão. Verifique os dados do cartão ou tente outro método de pagamento.');
      }
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.PENDING, domPaymentId: payment.id },
      });

      this.logger.log(`✅ [ZERO_GRAU] Transação ${transaction.id} atualizada para PENDING`);

      // Persist terminal gateway results through the same idempotent webhook path.
      // Returning the stored status prevents Delivery from confirming before SimIntPay.
      let status = this.tag === 'ATLAS' && gatewayStatus === 'paid' ? 'COMPLETED' : 'PENDING';
      if (this.tag === 'ZERO-GRAU' && !['pending', 'pending_capture'].includes(payment.status?.trim().toLowerCase())) {
        try {
          const settled = await this.reconcile!.reconcilePayment(payment.id, userId, this.domToken);
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
          total_fee: this.tag === 'BOSQUE' ? domFee : totalFeesFinal,
          total_amount: price,
          net_amount_seller: amountWithoutAllFee,
        },
      };
    } catch (error) {
      this.logger.error('❌ [ZERO_GRAU] Erro ao criar pagamento com cartão:', error);
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
      throw new BadRequestException(
        'Ocorreu um erro ao processar o pagamento. Por favor, verifique os dados e tente novamente.',
      );
    }
  }

  protected async createDomPagamentosPix(request: DomPixRequest): Promise<DomPagamentosResponse> {
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
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
      throw new BadRequestException(
        'Erro ao comunicar com o serviço de pagamento. Por favor, tente novamente mais tarde.',
      );
    }
  }

  protected async createDomPagamentosCreditCard(request: DomCreditCardRequest): Promise<DomPagamentosResponse> {
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
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
      throw new BadRequestException(
        'Erro ao comunicar com o serviço de pagamento. Por favor, tente novamente mais tarde.',
      );
    }
  }

  async checkPixStatusDirect(domPaymentId: string): Promise<{ status: string }> {
    const userId = (getPlatformOwnerId(this.tag) ?? '');
    if (!userId) return { status: 'UNKNOWN' };
    await this.assertPlatformOwner(userId);
    if (!this.reconcile) {
      const response = await fetch(`https://apiv3.dompagamentos.com.br/checkout/production/transactions/${encodeURIComponent(domPaymentId)}`, { headers: { Authorization: `Bearer ${this.domToken}`, accept: 'application/json' } });
      if (!response.ok) return { status: 'UNKNOWN' };
      const data = await response.json();
      return { status: String(data.status ?? 'UNKNOWN').toUpperCase() };
    }
    const result = await this.reconcile!.reconcilePayment(domPaymentId, userId, this.domToken);
    return { status: result.status };
  }
}
