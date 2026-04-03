import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  PAYMENT_GATEWAY,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS, type PlataformaTaxaKey } from '../../modules/platform-taxas/platform-taxas.keys';
import { Prisma } from '@prisma/client';

const DOM_CC_FEE_RATES: Record<number, number> = {
  1: 0.0399, 2: 0.0830, 3: 0.0968, 4: 0.1104, 5: 0.1237,
  6: 0.1367, 7: 0.1495, 8: 0.1621, 9: 0.1744, 10: 0.1864,
  11: 0.1983, 12: 0.2099,
};

type BuildEbookCheckoutBody = {
  value: number | string;
  description: string;
  store?: string;
  adminToken?: string | null;
  orderId?: string | number | null;
  orderNumber?: string | null;
  maxInstallments?: number | null;
};

type PublicPixBody = {
  description: string;
  name: string;
  email: string;
  document: string;
  document_type?: 'CPF' | 'CNPJ';
  mobile_phone: string;
  price: number;
  store?: string;
  orderNumber?: string;
  orderId?: string | number | null;
};

@Controller('checkout')
@ApiTags('Checkout')
export class CheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  @Post('ebook-url')
  @ApiOperation({ summary: 'Monta URL de checkout do SimPay para ebook' })
  buildEbookCheckoutUrl(
    @Body() body: BuildEbookCheckoutBody,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (expectedToken && internalToken !== expectedToken) {
      throw new UnauthorizedException('Token interno inválido');
    }

    const valueNum = Number(body?.value);
    if (!Number.isFinite(valueNum) || valueNum <= 0) {
      throw new BadRequestException('Valor inválido para checkout');
    }

    const description = String(body?.description ?? '').trim();
    if (!description) {
      throw new BadRequestException('Descrição é obrigatória');
    }

    const baseUrl = (process.env.SIMPAY_CHECKOUT_URL || 'https://checkout.jbmidia.com').replace(/\/+$/, '');
    const store = String(body?.store || 'ebook');

    let checkoutUrl = `${baseUrl}/?value=${valueNum}&description=${encodeURIComponent(description)}&store=${encodeURIComponent(store)}`;
    if (body?.orderId != null && String(body.orderId).length > 0) {
      checkoutUrl += `&orderId=${encodeURIComponent(String(body.orderId))}`;
    }
    if (body?.orderNumber) {
      checkoutUrl += `&orderNumber=${encodeURIComponent(body.orderNumber)}`;
    }
    if (body?.adminToken) {
      checkoutUrl += `&adminToken=${encodeURIComponent(body.adminToken)}`;
    }
    if (body?.maxInstallments && Number(body.maxInstallments) > 1) {
      checkoutUrl += `&maxInstallments=${Number(body.maxInstallments)}`;
    }

    return { checkoutUrl };
  }

  /**
   * Endpoint público equivalente ao POST /payments da api-dom.
   * Usado pelo checkout front-end para gerar QR code PIX avulso (ebook e outros).
   *
   * O back-ebook já cria a transação via /internal/ebook/finance/pending-transaction
   * com domPaymentId = EBOOK_PENDING_{orderNumber}. Este endpoint apenas gera o QR code
   * na DOM e atualiza o domPaymentId real na transação existente.
   */
  @Post('pix')
  @ApiOperation({ summary: 'Criar pagamento PIX avulso (ebook/store)' })
  async createPublicPix(@Body() body: PublicPixBody) {
    const domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new BadRequestException('Gateway de pagamento não configurado');

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('Valor inválido');
    if (!body.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!body.email?.includes('@')) throw new BadRequestException('Email inválido');
    if (!body.document) throw new BadRequestException('Documento é obrigatório');

    const description = String(body.description ?? '').trim() || `Pedido ebook`;
    const orderNumber = body.orderNumber ? String(body.orderNumber).trim() : null;

    // Busca a transação criada pelo back-ebook via notifyPendingTransaction
    let transaction: { id: string } | null = null;
    if (orderNumber) {
      transaction = await this.prisma.transaction.findFirst({
        where: { domPaymentId: `EBOOK_PENDING_${orderNumber}` },
        select: { id: true },
      });
    }

    const documentType = body.document_type ?? (body.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ');

    // Se não encontrou transação existente, cria uma nova com userId genérico da plataforma
    if (!transaction) {
      const store = String(body.store || 'ebook').toUpperCase();
      const tenantTag = store || 'EBOOK';

      // Usuário genérico por plataforma para transações sem usuário autenticado
      const platformUserId = `d4fbf80f-6f13-4bc6-8e15-${tenantTag.toLowerCase().padEnd(12, '0').slice(0, 12)}`;
      const platformEmail = `${tenantTag.toLowerCase()}-platform@auto.simpay.com`;
      await this.prisma.user.upsert({
        where: { id: platformUserId },
        update: {},
        create: {
          id: platformUserId,
          name: `${tenantTag} Platform`,
          email: platformEmail,
          cpf: '00000000000',
          password: 'SYSTEM_NO_LOGIN',
        },
      });

      const liquidez = getPlatformTaxaEffective(tenantTag, 'LIQUIDEZ', 0.91);
      const mdrPix = getPlatformTaxaEffective(tenantTag, 'MDR_PIX', 0.0098);
      const netAmount = parseFloat((price * liquidez).toFixed(2));
      const totalFee = parseFloat((price * (1 - liquidez)).toFixed(2));
      const domFee = parseFloat((price * mdrPix).toFixed(2));
      const platformFee = parseFloat((totalFee - domFee).toFixed(2));

      transaction = await this.prisma.transaction.create({
        data: {
          userId: platformUserId,
          amount: new Prisma.Decimal(price),
          netAmount: new Prisma.Decimal(netAmount),
          status: 'DRAFT',
          paymentMethod: 'PIX',
          totalFee: new Prisma.Decimal(totalFee),
          domFee: new Prisma.Decimal(domFee),
          platformFee: new Prisma.Decimal(platformFee),
          description: `${description} [TENANT:${tenantTag}]${orderNumber ? ` [ORDER:${orderNumber}]` : ''}`,
          customerName: body.name.trim(),
          customerEmail: body.email.trim(),
          customerDocument: body.document.replace(/\D/g, ''),
          customerPhone: (body.mobile_phone ?? '').replace(/\D/g, ''),
        },
      });
    }

    const payment = await this.gateway.createPixCheckout(domToken, {
      codExternal: transaction.id,
      amount: price,
      description,
      customerName: body.name.trim(),
      customerEmail: body.email.trim(),
      customerDocument: body.document.replace(/\D/g, ''),
      customerPhone: (body.mobile_phone ?? '').replace(/\D/g, ''),
      documentType,
    });

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'PENDING', domPaymentId: payment.id },
    });

    return {
      id: payment.id,
      transactionId: transaction.id,
      status: 'PENDING',
      pix_content: payment.pixContent,
      pix_copy_paste: payment.pixContent,
      qr_code: payment.qrCode,
      pix_qrcode: payment.qrCode,
      expires_in: 1440,
    };
  }

  /**
   * Polling de status de pagamento PIX avulso.
   * Retorna o status da transação no simpay, mapeado para o formato esperado pelo checkout.
   */
  @Get('pix/:id/status')
  @ApiOperation({ summary: 'Consultar status de pagamento PIX avulso' })
  async getPixStatus(@Param('id') id: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [{ domPaymentId: id }, { id }],
      },
      select: { status: true, domPaymentId: true },
    });

    if (!tx) throw new NotFoundException('Pagamento não encontrado');

    const statusMap: Record<string, string> = {
      COMPLETED: 'COMPLETED',
      PENDING: 'PENDING',
      FAILED: 'FAILED',
      EXPIRED: 'EXPIRED',
      DRAFT: 'PENDING',
    };

    return {
      id,
      status: statusMap[tx.status] ?? tx.status,
    };
  }

  /**
   * Retorna as opções de parcelamento com MDR_CC_MASTER para checkout de cartão avulso (ebook).
   * Usado pelo frontend antes de exibir o dropdown de parcelas.
   */
  @Post('card/installment-options')
  @ApiOperation({ summary: 'Calcular opções de parcelamento com MDR_CC_MASTER (ebook/avulso/pagatg)' })
  getCardInstallmentOptions(
    @Body() body: { price: number; store?: string; maxInstallments?: number },
  ) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('Valor inválido');

    const store = String(body.store || 'ebook').toUpperCase();
    const tenantTag = store === 'EBOOKSIM' ? 'EBOOKSIM' : store === 'PAGATG' ? 'PAGATG' : 'EBOOK';
    const max = Math.min(Math.max(Number(body.maxInstallments) || 1, 1), 12);

    const options = [];
    for (let n = 1; n <= max; n++) {
      const mdrMasterKey = `MDR_CC_MASTER_${n}X` as PlataformaTaxaKey;
      const masterRate = getPlatformTaxaEffective(tenantTag, mdrMasterKey, PLATFORM_TAXA_DEFAULTS[mdrMasterKey]);
      const interestAmount = price * masterRate;
      const valueWithInterest = price + interestAmount;
      const domRate = DOM_CC_FEE_RATES[n] ?? 0;
      const domFixed = n > 1 ? 1.0 : 0;
      const domFeeAmount = valueWithInterest * domRate + domFixed;
      const totalAmount = Math.round((valueWithInterest + domFeeAmount) * 100) / 100;
      const installmentAmount = Math.round((totalAmount / n) * 100) / 100;
      options.push({
        installments: n,
        masterRate,
        interestAmount: Math.round(interestAmount * 100) / 100,
        domRate,
        domFeeAmount: Math.round(domFeeAmount * 100) / 100,
        totalAmount,
        installmentAmount,
        hasInterest: masterRate > 0,
      });
    }
    return { options };
  }

  /**
   * Endpoint público para pagamento com cartão de crédito avulso (ebook e outros).
   * Substitui o endpoint api-dom.jbmidia.com/payments/credit-card para store=ebook.
   * Aplica MDR_CC_MASTER por parcela para calcular o valor que o comprador paga.
   */
  @Post('card')
  @ApiOperation({ summary: 'Criar pagamento com cartão de crédito avulso (ebook/store)' })
  async createPublicCard(
    @Body() body: {
      price: number;
      holder_name: string;
      token: string;
      bin: string;
      brand: string;
      installments: number;
      description: string;
      email: string;
      document: string;
      document_type?: 'CPF' | 'CNPJ';
      mobile_phone: string;
      name: string;
      store?: string;
      orderNumber?: string;
    },
  ) {
    const domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new BadRequestException('Gateway de pagamento não configurado');

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('Valor inválido');
    if (!body.holder_name?.trim()) throw new BadRequestException('Nome do titular é obrigatório');
    if (!body.token) throw new BadRequestException('Token do cartão é obrigatório');
    if (!body.email?.includes('@')) throw new BadRequestException('Email inválido');
    if (!body.document) throw new BadRequestException('Documento é obrigatório');

    const n = Math.min(Math.max(Number(body.installments) || 1, 1), 12);
    const store = String(body.store || 'ebook').toUpperCase();
    const tenantTag = store === 'EBOOKSIM' ? 'EBOOKSIM' : 'EBOOK';
    const orderNumber = body.orderNumber ? String(body.orderNumber).trim() : null;
    const description = String(body.description ?? '').trim() || 'Pedido ebook';
    const documentType = body.document_type ?? (body.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ');

    // Calcular total com MDR_CC_MASTER
    const mdrMasterKey = `MDR_CC_MASTER_${n}X` as PlataformaTaxaKey;
    const masterRate = getPlatformTaxaEffective(tenantTag, mdrMasterKey, PLATFORM_TAXA_DEFAULTS[mdrMasterKey]);
    const interestAmount = price * masterRate;
    const valueWithInterest = price + interestAmount;
    const domRate = DOM_CC_FEE_RATES[n] ?? 0;
    const domFixed = n > 1 ? 1.0 : 0;
    const domFeeAmount = valueWithInterest * domRate + domFixed;
    const totalAmount = Math.round((valueWithInterest + domFeeAmount) * 100) / 100;
    const installmentAmount = Math.round((totalAmount / n) * 100) / 100;

    // Busca ou cria transação
    let transaction: { id: string } | null = null;
    if (orderNumber) {
      transaction = await this.prisma.transaction.findFirst({
        where: { domPaymentId: `EBOOK_PENDING_${orderNumber}` },
        select: { id: true },
      });
    }

    if (!transaction) {
      await this.prisma.user.upsert({
        where: { id: 'd4fbf80f-6f13-4bc6-8e15-ebook00000001' },
        update: {},
        create: {
          id: 'd4fbf80f-6f13-4bc6-8e15-ebook00000001',
          name: 'EbookSim Platform',
          email: 'ebook-platform@ebooksim.com',
          cpf: '00000000000',
          password: 'SYSTEM_NO_LOGIN',
        },
      });

      const liquidez = getPlatformTaxaEffective(tenantTag, 'LIQUIDEZ', 0.91);
      const netAmount = Math.round(price * liquidez * 100) / 100;
      const totalFee = Math.round((price - netAmount) * 100) / 100;
      const domFee = Math.round(domFeeAmount * 100) / 100;
      const platformFee = Math.round((totalFee - domFee) * 100) / 100;

      transaction = await this.prisma.transaction.create({
        data: {
          userId: 'd4fbf80f-6f13-4bc6-8e15-ebook00000001',
          amount: new Prisma.Decimal(totalAmount),
          netAmount: new Prisma.Decimal(netAmount),
          status: 'DRAFT',
          paymentMethod: 'CREDIT_CARD',
          totalFee: new Prisma.Decimal(totalFee),
          domFee: new Prisma.Decimal(domFee),
          platformFee: new Prisma.Decimal(platformFee),
          description: `${description} [TENANT:${tenantTag}]${orderNumber ? ` [ORDER:${orderNumber}]` : ''}`,
          customerName: body.name.trim(),
          customerEmail: body.email.trim(),
          customerDocument: body.document.replace(/\D/g, ''),
          customerPhone: (body.mobile_phone ?? '').replace(/\D/g, ''),
        },
      });
    }

    // Chamar DOM API diretamente para criar transação de cartão
    const domUrl = 'https://apiv3.dompagamentos.com.br/checkout/production/transactions';
    const domBody = {
      cod_external: transaction.id,
      customer: {
        document: body.document.replace(/\D/g, ''),
        document_type: documentType,
        email: body.email.trim(),
        mobile_phone: (body.mobile_phone ?? '').replace(/\D/g, ''),
        name: body.name.trim(),
      },
      items: {
        description,
        price,
        quantity: 1,
      },
      payment: {
        credit_card: {
          holder_name: body.holder_name,
          token: body.token,
          bin: body.bin,
          brand: body.brand,
          installments: n,
          installment_amount: installmentAmount,
        },
        payment_method: 'credit_card',
        total: totalAmount,
      },
    };

    const domResponse = await fetch(domUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${domToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(domBody),
    });

    const domData = await domResponse.json();
    if (!domResponse.ok) {
      throw new BadRequestException(domData?.message || 'Erro ao processar pagamento no gateway');
    }

    const domPaymentId = domData?.data?.id ?? domData?.id;
    if (domPaymentId) {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'PENDING', domPaymentId },
      });
    }

    return {
      id: domPaymentId ?? transaction.id,
      transactionId: transaction.id,
      status: domData?.data?.status ?? domData?.status ?? 'PENDING',
      installments: n,
      installmentAmount,
      totalAmount,
    };
  }
}
