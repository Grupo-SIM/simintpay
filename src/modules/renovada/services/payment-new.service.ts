import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
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
export class PaymentNewService {
  private readonly logger = new Logger(PaymentNewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createPaymentPix(
    userId: string,
    body: CheckoutPixDto,
  ): Promise<any> {
    try {
      this.logger.log(`📱 [RENOVADA] Criando pagamento PIX para usuário ${userId}`, {
        price: body.price,
        document: body.document,
        email: body.email,
      });

      // Validações
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

      // Calcular taxas (9% total)
      const domFeeRate = 0.09; // 9%
      const domFee = price * domFeeRate;
      
      // amountWithoutAllFee deve ser 91% do valor original
      const amountWithoutAllFee = price * 0.91;
      const totalFees = domFee;

      // Buscar a wallet do usuário
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new BadRequestException('Carteira não encontrada');
      }

      // Criar transação
      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          amount: price,
          status: TransactionStatus.DRAFT,
          netAmount: amountWithoutAllFee,
          totalFee: totalFees,
          domFee,
          platformFee: totalFees,
          paymentMethod: PaymentMethod.PIX,
          description: body?.description ?? '-',
          customerName: body?.name,
          customerEmail: body?.email,
          customerDocument: body?.document,
          customerPhone: body?.mobile_phone,
          installments: 1,
        },
      });

      this.logger.log(`✅ [RENOVADA] Transação criada: ${transaction.id}`);

      // Preparar requisição para DOM
      const paymentRequest: DomPixRequest = {
        cod_external: transaction.id,
        customer: {
          document: body.document.replace(/[.-]/g, ''), // Remove pontos e traços
          document_type: body.document_type,
          email: body.email,
          mobile_phone: body.mobile_phone || '',
          name: body.name,
        },
        items: {
          description: body.description || 'Pagamento PIX',
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

      this.logger.log('📤 [RENOVADA] Enviando requisição para DOM Pagamentos');

      // Processar pagamento na DOM
      const payment = await this.createDomPagamentosPix(paymentRequest);

      this.logger.log('📥 [RENOVADA] Resposta do DOM Pagamentos recebida', {
        paymentId: payment.id,
        status: payment.status,
      });

      // Atualizar transação com resposta do DOM
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

      this.logger.log(`✅ [RENOVADA] Transação ${transaction.id} atualizada para PENDING`);

      return {
        ...payment,
        transactionId: transaction.id,
        paymentId: payment.id,
        status: 'PENDING',
      };
    } catch (error) {
      this.logger.error('❌ [RENOVADA] Erro ao criar pagamento PIX:', error);
      
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Ocorreu um erro ao processar o pagamento. Por favor, verifique os dados e tente novamente.',
      );
    }
  }

  async createPaymentCreditCard(
    userId: string,
    body: CheckoutCreditCardDto,
  ): Promise<any> {
    try {
      this.logger.log(`💳 [RENOVADA] Criando pagamento com cartão para usuário ${userId}`, {
        price: body.price,
        installments: body.installments,
        email: body.email,
      });

      // Validações
      if (!body.document || !body.document_type) {
        throw new BadRequestException('Documento e tipo de documento são obrigatórios');
      }

      if (!body.price || body.price <= 0) {
        throw new BadRequestException('Preço deve ser maior que zero');
      }

      const price = body.price;

      // Calcular taxas de cartão
      const installmentRates: Record<number, number> = {
        1: 0.0399, // 3,99% + R$ 1,00
        2: 0.083, // 8,3% + R$ 1,00
        3: 0.0968, // 9,68% + R$ 1,00
        4: 0.1104, // 11,04% + R$ 1,00
        5: 0.1237, // 12,37% + R$ 1,00
        6: 0.1367, // 13,67% + R$ 1,00
        7: 0.1495, // 14,95% + R$ 1,00
        8: 0.1621, // 16,21% + R$ 1,00
        9: 0.1744, // 17,44% + R$ 1,00
        10: 0.1864, // 18,64% + R$ 1,00
        11: 0.1983, // 19,83% + R$ 1,00
        12: 0.2099, // 20,99% + R$ 1,00
      };

      const installmentRate = installmentRates[body.installments] || 1;
      const fixedFee = 1.00;
      const totalFee = price * installmentRate + fixedFee;

      // DOM fee (9%)
      const domFeeRate = 0.09;
      const domFee = price * domFeeRate;

      // amountWithoutAllFee deve ser 91% do valor original
      const amountWithoutAllFee = price * 0.91;
      const totalFeesFinal = domFee;

      // Buscar a wallet do usuário
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new BadRequestException('Carteira não encontrada');
      }

      // Criar transação
      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          amount: price,
          status: TransactionStatus.DRAFT,
          netAmount: amountWithoutAllFee,
          totalFee: totalFeesFinal,
          domFee,
          platformFee: totalFeesFinal,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          description: body?.description ?? '-',
          customerName: body?.name,
          customerEmail: body?.email,
          customerDocument: body?.document,
          customerPhone: body?.mobile_phone,
          installments: body.installments,
          cardBrand: body.brand,
          cardBin: body.bin,
        },
      });

      this.logger.log(`✅ [RENOVADA] Transação criada: ${transaction.id}`);

      const installmentAmount = price / body.installments;

      // Preparar requisição para DOM
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
          description: body.description || 'Pagamento com Cartão',
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

      this.logger.log('📤 [RENOVADA] Enviando requisição para DOM Pagamentos');

      // Processar pagamento na DOM
      const payment = await this.createDomPagamentosCreditCard(paymentRequest);

      this.logger.log('📥 [RENOVADA] Resposta do DOM Pagamentos recebida', {
        paymentId: payment.id,
        status: payment.status,
      });

      // Atualizar transação com resposta do DOM
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.PENDING,
          domPaymentId: payment.id,
        },
      });

      this.logger.log(`✅ [RENOVADA] Transação ${transaction.id} atualizada para PENDING`);

      return {
        ...payment,
        transactionId: transaction.id,
        paymentId: payment.id,
        status: 'PENDING',
        fee_details: {
          installment_amount: installmentAmount,
          total_fee: totalFeesFinal,
          total_amount: price,
          net_amount_seller: amountWithoutAllFee,
        },
      };
    } catch (error) {
      this.logger.error('❌ [RENOVADA] Erro ao criar pagamento com cartão:', error);
      
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Ocorreu um erro ao processar o pagamento. Por favor, verifique os dados e tente novamente.',
      );
    }
  }

  private async createDomPagamentosPix(
    request: DomPixRequest,
  ): Promise<DomPagamentosResponse> {
    const url = 'https://apiv3.dompagamentos.com.br/checkout/production/transactions';

    const headers = {
      Authorization: `Bearer ${process.env.DOM_TOKEN}`,
      accept: 'application/json',
      'content-type': 'application/json',
      Origin: process.env.URL_APP || 'https://api-renovada.jbmidia.com',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      const responseData = await response.json();

      if (!response.ok) {
        this.logger.error('[RENOVADA] Erro do DOM Pagamentos (PIX):', {
          status: response.status,
          response: responseData,
          request: {
            cod_external: request.cod_external,
            payment_method: request.payment.payment_method,
            total: request.payment.total,
          },
        });

        let errorMessage = 'Erro ao processar pagamento PIX';
        switch (response.status) {
          case 400:
            errorMessage = responseData.message || 'Parâmetros de requisição inválidos';
            break;
          case 401:
            errorMessage = 'Credenciais de API inválidas';
            break;
          case 404:
            errorMessage = 'Serviço de pagamento não encontrado';
            break;
          case 422:
            errorMessage = 'Dados de pagamento inválidos';
            break;
          case 429:
            errorMessage = 'Muitas requisições, tente novamente mais tarde';
            break;
          case 500:
          case 502:
          case 503:
            errorMessage = 'Serviço de pagamento temporariamente indisponível';
            break;
          default:
            errorMessage = 'Erro ao processar o pagamento';
        }

        throw new BadRequestException(errorMessage);
      }

      this.logger.log('✅ [RENOVADA] Sucesso no DOM Pagamentos (PIX)', {
        id: responseData.id,
        status: responseData.status,
        cod_external: request.cod_external,
      });

      return responseData as DomPagamentosResponse;
    } catch (error) {
      this.logger.error('[RENOVADA] Erro na comunicação com DOM Pagamentos (PIX):', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Erro ao comunicar com o serviço de pagamento. Por favor, tente novamente mais tarde.',
      );
    }
  }

  private async createDomPagamentosCreditCard(
    request: DomCreditCardRequest,
  ): Promise<DomPagamentosResponse> {
    const url = 'https://apiv3.dompagamentos.com.br/checkout/production/transactions';

    const headers = {
      Authorization: `Bearer ${process.env.DOM_TOKEN}`,
      accept: 'application/json',
      'content-type': 'application/json',
      Origin: process.env.URL_APP || 'https://api-renovada.jbmidia.com',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      const responseData = await response.json();

      if (!response.ok) {
        this.logger.error('[RENOVADA] Erro do DOM Pagamentos (Cartão):', {
          status: response.status,
          response: responseData,
          request: {
            cod_external: request.cod_external,
            payment_method: request.payment.payment_method,
            total: request.payment.total,
          },
        });

        let errorMessage = 'Erro ao processar pagamento com cartão';
        switch (response.status) {
          case 400:
            errorMessage = responseData.message || 'Parâmetros de requisição inválidos';
            break;
          case 401:
            errorMessage = 'Credenciais de API inválidas';
            break;
          case 404:
            errorMessage = 'Serviço de pagamento não encontrado';
            break;
          case 422:
            errorMessage = 'Dados de cartão inválidos';
            break;
          case 429:
            errorMessage = 'Muitas requisições, tente novamente mais tarde';
            break;
          case 500:
          case 502:
          case 503:
            errorMessage = 'Serviço de pagamento temporariamente indisponível';
            break;
          default:
            errorMessage = 'Erro ao processar o pagamento';
        }

        throw new BadRequestException(errorMessage);
      }

      this.logger.log('✅ [RENOVADA] Sucesso no DOM Pagamentos (Cartão)', {
        id: responseData.id,
        status: responseData.status,
        cod_external: request.cod_external,
      });

      return responseData as DomPagamentosResponse;
    } catch (error) {
      this.logger.error('[RENOVADA] Erro na comunicação com DOM Pagamentos (Cartão):', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Erro ao comunicar com o serviço de pagamento. Por favor, tente novamente mais tarde.',
      );
    }
  }
}
