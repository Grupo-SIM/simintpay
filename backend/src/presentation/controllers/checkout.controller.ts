import {
  enrollEbook,
  claimEbookPayment,
  bindEbookPayment,
} from '../../modules/platform-core/ebook-enrollment';
import {
  bindAdoptedEbookEntry,
  findAdoptableEbookEntry,
} from '../../modules/platform-core/ebook-pending-adoption';
import { recoverEbookPayment } from '../../modules/platform-core/ebook-recovery';
import { timingSafeEqual } from 'node:crypto';
import { findOfferByCodeOrId } from '../../modules/offer/find-offer-by-code-or-id';
import { findOfferByAlias } from '../../modules/offer-access/find-offer-by-alias';
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
import { paymentTracking } from '../../modules/platform-core/payment-tracking';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  PAYMENT_GATEWAY,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import { Acquirer } from '../../core/services/acquirer.enum';
import { getFrendzApiToken } from '../../modules/frendz/frendz.config';
import { Prisma } from '@prisma/client';
import { VoucherService } from '../../application/use-cases/voucher/voucher.service';
import { CheckoutEventsService } from '../../application/services/checkout-events.service';
import { Observable, map, merge, timer, NEVER } from 'rxjs';

type BuildEbookCheckoutBody = {
  value: number | string;
  description: string;
  store?: string;
  adminToken?: string | null;
  orderId?: string | number | null;
  orderNumber?: string | null;
  settlement?: unknown;
  maxInstallments?: number | null;
};

/** Só sobrescreve o tracking de transação pré-existente quando o cliente enviou algum. */
function trackingUpdate(value: unknown) {
  const tracking = paymentTracking(value);
  return Object.keys(tracking).length ? { tracking } : {};
}

type PublicPixBody = {
  description: string;
  name: string;
  email: string;
  document: string;
  document_type?: 'CPF' | 'CNPJ';
  mobile_phone: string;
  price: number;
  orderNumber?: string;
  settlementId?: string;
  settlementToken?: string;
  orderId?: string | number | null;
  store?: string;
  tracking?: Record<string, string>;
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

  @Post('ebook-settlements/:id/recover')
  async recoverEbook(
    @Param('id') id: string,
    @Headers('x-internal-token') supplied: string,
    @Body() body: { paymentId: string },
  ) {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    if (
      !expected ||
      !supplied ||
      Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    )
      throw new UnauthorizedException();
    if (!body.paymentId || typeof body.paymentId !== 'string')
      throw new BadRequestException('paymentId obrigatório');
    const token = platformGatewayToken('EBOOK');
    if (!token) throw new BadRequestException('Credencial Ebook ausente');
    return recoverEbookPayment(
      this.prisma,
      this.gatewayResolver.byAcquirer(Acquirer.DOM),
      token,
      id,
      body.paymentId,
    );
  }

  @Post('ebook-url')
  @ApiOperation({ summary: 'Monta URL de checkout do SimPay para ebook' })
  async buildEbookCheckoutUrl(
    @Body() body: BuildEbookCheckoutBody,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (
      body.settlement &&
      (!expectedToken ||
        !internalToken ||
        Buffer.byteLength(internalToken) !== Buffer.byteLength(expectedToken) ||
        !timingSafeEqual(
          Buffer.from(internalToken),
          Buffer.from(expectedToken),
        ))
    )
      throw new UnauthorizedException(
        'Credencial interna obrigatória para liquidação',
      );
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

    if (body.settlement) {
      if (store !== 'ebook')
        throw new BadRequestException('Manifesto exclusivo Ebook');
      const enrolled = await enrollEbook(this.prisma, body.settlement);
      checkoutUrl += `&settlementId=${encodeURIComponent(enrolled.settlementId)}&settlementToken=${encodeURIComponent(enrolled.settlementToken)}`;
      return {
        checkoutUrl,
        settlementId: enrolled.settlementId,
        manifestHash: enrolled.manifestHash,
      };
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
    if (!financialQuote)
      throw new BadRequestException({ code: 'FINANCIAL_POLICY_MISSING' });
    const acquirer = this.gatewayResolver.acquirerForSlug(storeSlug);

    // Pedido Ebook sem manifesto: paga a entrada pendente do vendedor (EBOOK_PENDING_<pedido>) em vez de
    // criar um rascunho FINAL_NET do dono da plataforma, que nunca a concluiria.
    let transaction: { id: string } | null = await findAdoptableEbookEntry(
      this.prisma,
      {
        store: storeSlug,
        orderNumber,
        settlementId: body.settlementId,
        price,
      },
    );
    const adopted = transaction !== null;

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

      const netAmountDec = new Prisma.Decimal(financialQuote.netAmount);
      const totalFee = financialQuote.totalFeeAmount;
      const domFee = financialQuote.domFeeAmount;
      const platformFee = financialQuote.platformProfit;

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
          acquirerFee: new Prisma.Decimal(domFee),
          platformFee: new Prisma.Decimal(platformFee),
          ...transactionPlatformTagData(tenantTag),
          description: `${description} [TENANT:${tenantTag}]${orderNumber ? ` [ORDER:${orderNumber}]` : ''}`,
          customerName: body.name.trim(),
          customerEmail: body.email.trim(),
          customerDocument: body.document.replace(/\D/g, ''),
          customerPhone: (body.mobile_phone ?? '').replace(/\D/g, ''),
          tracking: paymentTracking(body.tracking),
        },
      });
    }

    // Roteia para a adquirente da loja. Token: api_token p/ Frendz, DOM_TOKEN p/ DOM.
    const gateway = this.gatewayResolver.byAcquirer(acquirer);
    const gatewayToken =
      acquirer === Acquirer.FRENDZ
        ? (getFrendzApiToken(storeSlug) ?? '')
        : domToken;

    const enrolled = adopted
      ? false
      : await claimEbookPayment(
          this.prisma,
          body,
          transaction.id,
          financialQuote,
        );
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

    if (enrolled)
      await bindEbookPayment(this.prisma, transaction.id, payment.id);
    // Persiste a adquirente e o id externo. Para a DOM, mantém domPaymentId
    // (consumido pelo webhook/sync atuais). Para a Frendz, o webhook localiza
    // por (acquirer, externalPaymentId) — não escreve em domPaymentId, que é
    // @unique e exclusivo do fluxo DOM.
    if (adopted) {
      // A entrada do vendedor mantém a chave EBOOK_PENDING_ (reenvio de finance/entries não duplica);
      // o webhook a encontra por (externalPaymentId) e a conclui uma única vez.
      await bindAdoptedEbookEntry(this.prisma, transaction.id, {
        externalPaymentId: payment.id,
        acquirer,
        method: 'PIX',
        installments: 1,
      });
    } else
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: 'PENDING',
          acquirer,
          externalPaymentId: payment.id,
          ...(acquirer === Acquirer.DOM ? { domPaymentId: payment.id } : {}),

          ...trackingUpdate(body.tracking),
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
        OR: [{ domPaymentId: id }, { id }, { externalPaymentId: id }],
      },
      include: { charge: { include: { offer: true } } },
    });

    if (!tx) {
      // Algumas assinaturas não criam Transaction imediatamente: o id é o do contrato.
      const contract = await this.prisma.billingContract.findUnique({
        where: { id },
        include: { offer: true },
      });

      if (!contract) throw new NotFoundException('Compra não encontrada');

      return {
        id: contract.id,
        type: 'SUBSCRIPTION',
        status: contract.status,
        payment_method: 'credit_card', // Fallback
        description: contract.offer?.name || 'Assinatura',
        customer: {
          email: contract.customerEmail,
          name: contract.customerName,
        },
        subscription: {
          createdAt: contract.createdAt,
          plan: {
            description: contract.offer?.name,
            value: Number(contract.unitAmount),
          },
        },
      };
    }

    const charge = tx.charge;
    const offer = charge?.offer ?? null;
    const isPixPlan = offer?.legacyType === 'PixCreditPlan';
    const isSub = !!offer && !isPixPlan && offer.renewalMode !== 'NONE';
    const daysCredited =
      charge?.periodStart && charge.periodEnd
        ? Math.round(
            (charge.periodEnd.getTime() - charge.periodStart.getTime()) /
              86_400_000,
          )
        : 0;

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
        isPixPlan && offer
          ? {
              name: offer.description || offer.name || 'Plano PIX',
              price: offer.amountCents / 100,
              daysCredited,
            }
          : null,
      subscription:
        isSub && offer
          ? {
              createdAt: tx.createdAt,
              plan: {
                description: offer.name,
                value: Number(tx.amount),
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
    throw new BadRequestException({ code: 'FINANCIAL_POLICY_MISSING' });
  }
}
