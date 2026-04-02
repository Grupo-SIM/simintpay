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
import { Prisma } from '@prisma/client';

type BuildEbookCheckoutBody = {
  value: number | string;
  description: string;
  store?: string;
  adminToken?: string | null;
  orderId?: string | number | null;
  orderNumber?: string | null;
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

      const store = String(body.store || 'ebook').toUpperCase();
      const tenantTag = store === 'EBOOKSIM' ? 'EBOOKSIM' : 'EBOOK';
      const liquidez = getPlatformTaxaEffective(tenantTag, 'LIQUIDEZ', 0.91);
      const mdrPix = getPlatformTaxaEffective(tenantTag, 'MDR_PIX', 0.0098);
      const netAmount = parseFloat((price * liquidez).toFixed(2));
      const totalFee = parseFloat((price * (1 - liquidez)).toFixed(2));
      const domFee = parseFloat((price * mdrPix).toFixed(2));
      const platformFee = parseFloat((totalFee - domFee).toFixed(2));

      transaction = await this.prisma.transaction.create({
        data: {
          userId: 'd4fbf80f-6f13-4bc6-8e15-ebook00000001',
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
}
