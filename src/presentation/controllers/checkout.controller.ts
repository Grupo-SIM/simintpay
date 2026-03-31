import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

type BuildEbookCheckoutBody = {
  value: number | string;
  description: string;
  store?: string;
  adminToken?: string | null;
  orderId?: string | number | null;
  orderNumber?: string | null;
};

@Controller('checkout')
@ApiTags('Checkout')
export class CheckoutController {
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
}
