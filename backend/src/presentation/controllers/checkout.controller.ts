import { transactionPlatformTagData } from '../../modules/platform-core/transaction-platform';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../../modules/financial-policy/financial-charge';
import {
  getPlatformOwnerId,
  getRegisteredPlatform,
} from '../../modules/module.registry';
import { platformGatewayToken } from '../../application/helpers/explicit-platform.helper';
import { getCustomerInterestRate } from '../../modules/platform-taxas/platform-taxas.store';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  MessageEvent,
  NotFoundException,
  Optional,
  Param,
  Post,
  Res,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  PAYMENT_GATEWAY,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import { Acquirer } from '../../core/services/acquirer.enum';
import { getFrendzApiToken } from '../../modules/frendz/frendz.config';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import {
  PLATFORM_TAXA_DEFAULTS,
  type PlataformaTaxaKey,
} from '../../modules/platform-taxas/platform-taxas.keys';
import { Prisma } from '@prisma/client';
import { VoucherService } from '../../application/use-cases/voucher/voucher.service';
import { calculateSellerNetValue } from '../../application/helpers/transaction-fee.helper';
import { CheckoutEventsService } from '../../application/services/checkout-events.service';
import { Observable, map, merge, timer, NEVER } from 'rxjs';

// Taxas DOM para modo "absorver juros" (vendedor absorve, ex: ebook)
const DOM_CC_FEE_RATES: Record<number, number> = {
  1: 0.0399,
  2: 0.083,
  3: 0.0968,
  4: 0.1104,
  5: 0.1237,
  6: 0.1367,
  7: 0.1495,
  8: 0.1621,
  9: 0.1744,
  10: 0.1864,
  11: 0.1983,
  12: 0.2099,
};

// Taxas DOM para modo "link de pagamento" (comprador paga, ex: pagatg)
const DOM_LINK_FEE_RATES: Record<number, number> = {
  1: 0.0,
  2: 0.0451,
  3: 0.0604,
  4: 0.0759,
  5: 0.0915,
  6: 0.1072,
  7: 0.1231,
  8: 0.1392,
  9: 0.1554,
  10: 0.1717,
  11: 0.1882,
  12: 0.2048,
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
  orderNumber?: string;
  orderId?: string | number | null;
  store?: string;
};

@Controller('checkout')
@ApiTags('Checkout')
export class CheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly gatewayResolver: PaymentGatewayResolver,
    private readonly voucherService: VoucherService,
    @Optional() private readonly checkoutEvents?: CheckoutEventsService,
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

    const baseUrl = process.env.SIMPAY_CHECKOUT_URL?.replace(/\/+$/, '');
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
    const domToken = platformGatewayToken(
      String(body.store || 'EBOOK'),
      process.env.DOM_TOKEN,
    );
    if (!domToken)
      throw new BadRequestException('Gateway de pagamento não configurado');

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0)
      throw new BadRequestException('Valor inválido');
    if (!body.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!body.email?.includes('@'))
      throw new BadRequestException('Email inválido');
    if (!body.document)
      throw new BadRequestException('Documento é obrigatório');

    const description = String(body.description ?? '').trim() || `Pedido ebook`;
    const orderNumber = body.orderNumber
      ? String(body.orderNumber).trim()
      : null;

    // Loja/tenant desta cobrança — também decide a adquirente (DOM por padrão).
    const storeSlug = String(body.store || 'ebook').toLowerCase();
    const financialQuote = quoteFinancialCharge(
      await loadChargePolicy(this.prisma, storeSlug.toUpperCase()),
      price,
      'PIX',
    );
    const acquirer = this.gatewayResolver.acquirerForSlug(storeSlug);

    // Busca a transação criada pelo back-ebook via notifyPendingTransaction
    let transaction: { id: string } | null = null;
    if (orderNumber && !financialQuote) {
      transaction = await this.prisma.transaction.findFirst({
        where: { domPaymentId: `EBOOK_PENDING_${orderNumber}` },
        select: { id: true },
      });
    }

    const documentType =
      body.document_type ??
      (body.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ');

    // Se não encontrou transação existente, cria uma nova com userId genérico da plataforma
    if (!transaction) {
      const store = String(body.store || 'ebook').toUpperCase();
      const tenantTag = store || 'EBOOK';

      // Usuário genérico por plataforma para transações sem usuário autenticado
      const platformUserId = getPlatformOwnerId(tenantTag);
      if (!platformUserId)
        throw new BadRequestException('Plataforma sem dono ativo cadastrado');

      const price = Number(body.price);
      const netAmountDec = financialQuote
        ? new Prisma.Decimal(financialQuote.netAmount)
        : calculateSellerNetValue(price, 1, tenantTag, 'pix');
      const netAmount = Number(netAmountDec.toFixed(2));
      const totalFee =
        financialQuote?.totalFeeAmount ??
        parseFloat((price - netAmount).toFixed(2));
      const mdrPix = getPlatformTaxaEffective(
        tenantTag,
        'MDR_PIX',
        PLATFORM_TAXA_DEFAULTS.MDR_PIX,
      );
      const domFee =
        financialQuote?.domFeeAmount ?? parseFloat((price * mdrPix).toFixed(2));
      const platformFee = parseFloat((totalFee - domFee).toFixed(2));

      transaction = await this.prisma.transaction.create({
        data: {
          userId: platformUserId,
          ...(financialQuote
            ? {
                financialSnapshot: financialQuote.financialSnapshot,
                settlementBasis: 'FINAL_NET' as const,
              }
            : {}),
          amount: new Prisma.Decimal(financialQuote?.totalAmount ?? price),
          netAmount: netAmountDec,
          status: 'DRAFT',
          paymentMethod: 'PIX',
          totalFee: new Prisma.Decimal(totalFee),
          domFee: new Prisma.Decimal(domFee),
          platformFee: new Prisma.Decimal(platformFee),
          ...transactionPlatformTagData(tenantTag),
          description: `${description} [TENANT:${tenantTag}]${orderNumber ? ` [ORDER:${orderNumber}]` : ''}`,
          customerName: body.name.trim(),
          customerEmail: body.email.trim(),
          customerDocument: body.document.replace(/\D/g, ''),
          customerPhone: (body.mobile_phone ?? '').replace(/\D/g, ''),
        },
      });
    }

    // Roteia para a adquirente da loja. Token: api_token p/ Frendz, DOM_TOKEN p/ DOM.
    const gateway = this.gatewayResolver.byAcquirer(acquirer);
    const gatewayToken =
      acquirer === Acquirer.FRENDZ
        ? (getFrendzApiToken(storeSlug) ?? '')
        : domToken;

    const payment = await gateway.createPixCheckout(gatewayToken, {
      codExternal: transaction.id,
      amount: financialQuote?.totalAmount ?? price,
      description,
      customerName: body.name.trim(),
      customerEmail: body.email.trim(),
      customerDocument: body.document.replace(/\D/g, ''),
      customerPhone: (body.mobile_phone ?? '').replace(/\D/g, ''),
      documentType,
    });

    // Persiste a adquirente e o id externo. Para a DOM, mantém domPaymentId
    // (consumido pelo webhook/sync atuais). Para a Frendz, o webhook localiza
    // por (acquirer, externalPaymentId) — não escreve em domPaymentId, que é
    // @unique e exclusivo do fluxo DOM.
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'PENDING',
        acquirer,
        externalPaymentId: payment.id,
        ...(acquirer === Acquirer.DOM ? { domPaymentId: payment.id } : {}),
      },
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
  @Get(['payments/:id/status', 'pix/:id/status'])
  @ApiOperation({ summary: 'Consultar status de pagamento (PIX ou Cartão)' })
  async getPaymentStatus(@Param('id') id: string) {
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

  @Sse('pix/:paymentId/sse')
  @ApiOperation({
    summary:
      'SSE: receber confirmação de pagamento PIX em tempo real (ebook/pagatg)',
  })
  ssePaymentStatus(
    @Param('paymentId') paymentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Observable<MessageEvent> {
    // Headers obrigatórios para SSE funcionar atrás de nginx/proxy
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!this.checkoutEvents) {
      return NEVER;
    }

    // Heartbeat a cada 8s para evitar timeout do nginx/proxy
    const heartbeat$ = timer(0, 8000).pipe(
      map(
        () =>
          ({ data: { type: 'heartbeat' }, type: 'heartbeat' }) as MessageEvent,
      ),
    );

    const payment$ = this.checkoutEvents.getStream(paymentId).pipe(
      map(
        (event) =>
          ({
            data: event,
            id: event.domPaymentId,
            type: 'payment-status',
          }) as MessageEvent,
      ),
    );

    return merge(heartbeat$, payment$);
  }

  /**
   * Retorna as opções de parcelamento com MDR_CC_MASTER para checkout de cartão avulso (ebook).
   * Usado pelo frontend antes de exibir o dropdown de parcelas.
   */
  @Post('card/installment-options')
  @ApiOperation({
    summary: 'Calcular opções de parcelamento com MDR_CC_MASTER por plataforma',
  })
  async getCardInstallmentOptions(
    @Body() body: { price: number; store?: string; maxInstallments?: number },
  ) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0)
      throw new BadRequestException('Valor inválido');

    const store = String(body.store || 'GLOBAL').toUpperCase();
    // Aceita qualquer plataforma configurada; CARDMACHINE sem tag específica cai em GLOBAL
    const tenantTag = store === 'CARDMACHINE' ? 'GLOBAL' : store;
    if (tenantTag !== 'GLOBAL' && !getRegisteredPlatform(tenantTag))
      throw new BadRequestException('Plataforma não cadastrada');
    const isLinkMode = tenantTag === 'PAGATG';
    const max = Math.min(Math.max(Number(body.maxInstallments) || 1, 1), 12);

    const financialContext = await loadChargePolicy(this.prisma, tenantTag);
    const options = [];
    for (let n = 1; n <= max; n++) {
      const quote = quoteFinancialCharge(
        financialContext,
        price,
        'CREDIT_CARD',
        n,
      );
      if (quote) {
        options.push({
          installments: n,
          masterRate: quote.platformFeeRate / 100,
          interestAmount: quote.interestAmount,
          domRate: 0,
          domFeeAmount: 0,
          totalAmount: quote.totalAmount,
          installmentAmount: quote.installmentAmount,
          hasInterest: quote.interestAmount > 0,
        });
        continue;
      }
      const masterRate = getCustomerInterestRate(tenantTag, n);
      const domRate = isLinkMode
        ? (DOM_LINK_FEE_RATES[n] ?? 0)
        : (DOM_CC_FEE_RATES[n] ?? 0);
      const domFixed = n > 1 ? 1.0 : 0;

      let totalAmount: number;
      let domFeeAmount: number;
      let interestAmount: number;

      if (n === 1) {
        // 1x: fórmula aditiva — comprador paga price × (1 + DOM + plataforma)
        interestAmount = Math.round(price * masterRate * 100) / 100;
        domFeeAmount = Math.round(price * domRate * 100) / 100;
        totalAmount =
          Math.round((price + interestAmount + domFeeAmount) * 100) / 100;
      } else {
        // 2x+: plataforma aplica juros primeiro, depois DOM incide sobre o total com juros
        interestAmount = Math.round(price * masterRate * 100) / 100;
        const valueWithInterest = price + interestAmount;
        domFeeAmount =
          Math.round((valueWithInterest * domRate + domFixed) * 100) / 100;
        totalAmount =
          Math.round((valueWithInterest + domFeeAmount) * 100) / 100;
      }

      const installmentAmount = Math.round((totalAmount / n) * 100) / 100;
      options.push({
        installments: n,
        masterRate,
        interestAmount,
        domRate,
        domFeeAmount,
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
  @ApiOperation({
    summary: 'Criar pagamento com cartão de crédito avulso (ebook/store)',
  })
  async createPublicCard(
    @Body()
    body: {
      price: number;
      holder_name: string;
      token: string;
      bin: string;
      brand: string;
      installments: number;
      description: string;
      name: string;
      email: string;
      document: string;
      document_type?: 'CPF' | 'CNPJ';
      mobile_phone?: string;
      store?: string;
      orderNumber?: string;
    },
  ) {
    const domToken = platformGatewayToken(
      String(body.store || 'EBOOK'),
      process.env.DOM_TOKEN,
    );
    if (!domToken)
      throw new BadRequestException('Gateway de pagamento não configurado');

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0)
      throw new BadRequestException('Valor inválido');
    if (!body.holder_name?.trim())
      throw new BadRequestException('Nome do titular é obrigatório');
    if (!body.token)
      throw new BadRequestException('Token do cartão é obrigatório');
    if (!body.email?.includes('@'))
      throw new BadRequestException('Email inválido');
    if (!body.document)
      throw new BadRequestException('Documento é obrigatório');

    const n = Math.min(Math.max(Number(body.installments) || 1, 1), 12);
    const store = String(body.store || 'ebook').toUpperCase();
    const tenantTag = store === 'CARDMACHINE' ? 'GLOBAL' : store;
    if (tenantTag !== 'GLOBAL' && !getRegisteredPlatform(tenantTag))
      throw new BadRequestException('Plataforma não cadastrada');
    const isLinkMode = tenantTag === 'PAGATG';
    const orderNumber = body.orderNumber
      ? String(body.orderNumber).trim()
      : null;
    const description = String(body.description ?? '').trim() || 'Pedido ebook';
    const documentType =
      body.document_type ??
      (body.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ');

    // Calcular total com MDR_CC_MASTER
    const masterRate = getCustomerInterestRate(tenantTag, n);
    const domRate = isLinkMode
      ? (DOM_LINK_FEE_RATES[n] ?? 0)
      : (DOM_CC_FEE_RATES[n] ?? 0);
    const domFixed = n > 1 ? 1.0 : 0;

    let totalAmount: number;
    let domFeeAmount: number;

    if (n === 1) {
      // 1x: fórmula aditiva — price + (DOM_1x + plataforma_1x) × price
      domFeeAmount = Math.round(price * domRate * 100) / 100;
      const platformFeeAmount = Math.round(price * masterRate * 100) / 100;
      totalAmount =
        Math.round((price + domFeeAmount + platformFeeAmount) * 100) / 100;
    } else {
      // 2x+: plataforma aplica juros primeiro, depois DOM incide sobre o total
      const interestAmount = price * masterRate;
      const valueWithInterest = price + interestAmount;
      domFeeAmount =
        Math.round((valueWithInterest * domRate + domFixed) * 100) / 100;
      totalAmount = Math.round((valueWithInterest + domFeeAmount) * 100) / 100;
    }

    const financialQuote = quoteFinancialCharge(
      await loadChargePolicy(this.prisma, tenantTag),
      price,
      'CREDIT_CARD',
      n,
    );
    if (financialQuote) {
      totalAmount = financialQuote.totalAmount;
      domFeeAmount = financialQuote.domFeeAmount;
    }
    const installmentAmount = Math.round((totalAmount / n) * 100) / 100;

    // Busca ou cria transação
    let transaction: { id: string } | null = null;
    if (orderNumber && !financialQuote) {
      transaction = await this.prisma.transaction.findFirst({
        where: { domPaymentId: `EBOOK_PENDING_${orderNumber}` },
        select: { id: true },
      });
    }

    if (!transaction) {
      const ebookUserId = getPlatformOwnerId(tenantTag);
      if (!ebookUserId)
        throw new BadRequestException('Plataforma sem dono ativo cadastrado');

      const netAmountDec = financialQuote
        ? new Prisma.Decimal(financialQuote.netAmount)
        : calculateSellerNetValue(price, n, tenantTag, 'credit_card');
      const netAmount = Number(netAmountDec.toFixed(2));
      const totalFee = Math.round((totalAmount - netAmount) * 100) / 100;
      const domFee = Math.round(domFeeAmount * 100) / 100;
      const platformFee = Math.round((totalFee - domFee) * 100) / 100;

      transaction = await this.prisma.transaction.create({
        data: {
          userId: ebookUserId,
          ...(financialQuote
            ? {
                financialSnapshot: financialQuote.financialSnapshot,
                settlementBasis: 'FINAL_NET' as const,
              }
            : {}),
          amount: new Prisma.Decimal(totalAmount),
          netAmount: netAmountDec,
          status: 'DRAFT',
          paymentMethod: 'CREDIT_CARD',
          totalFee: new Prisma.Decimal(totalFee),
          domFee: new Prisma.Decimal(domFee),
          platformFee: new Prisma.Decimal(platformFee),
          ...transactionPlatformTagData(tenantTag),
          description: `${description} [TENANT:${tenantTag}]${orderNumber ? ` [ORDER:${orderNumber}]` : ''}`,
          customerName: body.name.trim(),
          customerEmail: body.email.trim(),
          customerDocument: body.document.replace(/\D/g, ''),
          customerPhone: (body.mobile_phone ?? '').replace(/\D/g, ''),
        },
      });
    }

    // Chamar DOM API diretamente para criar transação de cartão
    const domUrl =
      'https://apiv3.dompagamentos.com.br/checkout/production/transactions';
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
      throw new BadRequestException(
        domData?.message || 'Erro ao processar pagamento no gateway',
      );
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

  @Post('public/validate-voucher')
  @ApiOperation({
    summary: 'Validar voucher para checkout público (PIX Plan ou Avulso)',
  })
  async validateVoucher(
    @Body() body: { linkCode: string; voucherCode: string; amount: number },
  ) {
    // Busca o plano pelo code para descobrir o dono (userId)
    const plan = await this.prisma.pixCreditPlan.findFirst({
      where: { linkCodes: { some: { code: body.linkCode } } },
    });

    if (!plan)
      throw new NotFoundException('Plano não encontrado para este código');

    const result = await this.voucherService.validateVoucherPublic({
      code: body.voucherCode,
      amount: body.amount,
      channel: 'PAGATG',
      linkCode: body.linkCode,
      planId: plan.id,
      targetOwnerId: plan.userId,
    });

    return result;
  }

  @Get('public/purchase/:id')
  @ApiOperation({
    summary: 'Detalhes públicos de uma compra (checkout success)',
  })
  async getPurchaseDetails(@Param('id') id: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [{ domPaymentId: id }, { id }],
      },
      include: {
        pixPlanOrder: { include: { pixCreditPlan: true } },
      },
    });

    if (!tx) {
      // Tentar buscar direto na SubscriptionLinkOrder (algumas assinaturas não criam Transaction imediatamente ou usam ID diferente)
      const order = await this.prisma.subscriptionLinkOrder.findUnique({
        where: { id },
        include: { subscriptionLink: true },
      });

      if (!order) throw new NotFoundException('Compra não encontrada');

      return {
        id: order.id,
        type: 'SUBSCRIPTION',
        status: order.status.toUpperCase(),
        payment_method: 'credit_card', // Fallback
        description: order.subscriptionLink?.name || 'Assinatura',
        customer: {
          email: order.customerEmail,
          name: order.customerName,
        },
        subscription: {
          createdAt: order.createdAt,
          plan: {
            description: order.subscriptionLink?.name,
            value: Number(order.amountCharged),
          },
        },
      };
    }

    const isPixPlan = !!tx.pixPlanOrder;
    // Busca se existe uma ordem de assinatura vinculada (via domPaymentId do PIX ou ID da transação)
    const subOrder = await this.prisma.subscriptionLinkOrder.findFirst({
      where: {
        OR: [{ domPixPaymentId: tx.domPaymentId ?? undefined }, { id: tx.id }],
      },
      include: { subscriptionLink: true },
    });
    const isSub = !!subOrder;

    return {
      id: tx.id,
      type: isPixPlan ? 'PIX_PLAN' : isSub ? 'SUBSCRIPTION' : 'TRANSACTION',
      status: tx.status,
      payment_method: tx.paymentMethod.toLowerCase(),
      description: tx.description,
      customer: {
        name: tx.customerName,
        email: tx.customerEmail,
      },
      transaction: {
        createdAt: tx.createdAt,
        amount: Number(tx.amount),
      },
      plan:
        isPixPlan && tx.pixPlanOrder?.pixCreditPlan
          ? {
              name: tx.pixPlanOrder.pixCreditPlan.description || 'Plano PIX',
              price: Number(tx.pixPlanOrder.pixCreditPlan.price),
              daysCredited: tx.pixPlanOrder.daysCredited,
            }
          : null,
      subscription: subOrder
        ? {
            createdAt: tx.createdAt,
            plan: {
              description: subOrder.subscriptionLink?.name,
              value: Number(subOrder.amountCharged ?? tx.amount),
            },
          }
        : null,
      planAccess: isPixPlan
        ? {
            isActive: tx.status === 'COMPLETED',
          }
        : null,
    };
  }

  @Get('public/cc-rates/:tag')
  @ApiOperation({
    summary:
      'Taxas de checkout para o comprador e vendedor de uma plataforma (público)',
  })
  async getCcRates(@Param('tag') tag: string) {
    const context = await loadChargePolicy(this.prisma, tag.toUpperCase());
    const quotes = Array.from({ length: 12 }, (_, i) =>
      quoteFinancialCharge(context, 100, 'CREDIT_CARD', i + 1),
    );
    if (quotes.some(Boolean)) {
      return {
        tag: tag.toUpperCase(),
        version: context.policy.version,
        installments: quotes.map((quote, i) => {
          const key = `${context.acquirer}/CREDIT_CARD/ONLINE/${i + 1}`;
          const fixedFee = context.policy.document.interestOnly
            ? 0
            : (context.policy.document.owner[key]?.fixedCents ?? 0) / 100;
          return {
            n: i + 1,
            buyerRate: quote
              ? (quote.totalAmount - 100 - fixedFee) / 100
              : null,
            fixedFee,
          };
        }),
      };
    }
    const fb = (k: PlataformaTaxaKey) => PLATFORM_TAXA_DEFAULTS[k] ?? 0;

    const masterCcRate = getCustomerInterestRate(tag, 1);
    // 1x: comprador não paga DOM (absorvido pela SimIntPay); só paga masterCcRate (0% para ATLAS 1x)
    const buyerCcRate = masterCcRate;

    const installments = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map(
      (n) => {
        const domKey = `MDR_CC_${n}X` as PlataformaTaxaKey;
        const domRate = getPlatformTaxaEffective(tag, domKey, fb(domKey));
        const masterRate = getCustomerInterestRate(tag, n);
        // 1x: grátis ao comprador. 2x+: DOM + master + R$1 fixo
        return {
          n,
          buyerRate: n === 1 ? 0 : domRate + masterRate,
          fixedFee: n === 1 ? 0 : 1,
        };
      },
    );

    return {
      tag: tag.toUpperCase(),
      buyerCcRate,
      installments,
    };
  }
}
