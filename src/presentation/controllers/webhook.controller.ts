import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Post,
  Req,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Inject } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  QUEUE_SERVICE,
  type IQueueService,
} from '../../core/services/queue.interface';
import { QueueNames } from '../../infrastructure/queue/queue-names';

@Controller('webhook')
@ApiTags('Webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(@Inject(QUEUE_SERVICE) private readonly queue: IQueueService) {}

  @Post('eventos')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Receber eventos de webhook' })
  @ApiBody({
    schema: {
      example: {
        type: 'payment.created',
        data: { id: 'uuid-event-1' },
      },
    },
  })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Invalid webhook secret' } } })
  async handle(
    @Body() body: unknown,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-secret') secretHeader: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<{ status: string }> {
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (!expectedSecret) {
      this.logger.error('WEBHOOK_SECRET not configured');
      throw new UnauthorizedException('Webhook not configured');
    }

    if (!secretHeader || secretHeader !== expectedSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const raw = req.rawBody;
    if (!raw || !signature) {
      throw new UnauthorizedException('Missing signature or body');
    }

    const computed = createHmac('sha256', expectedSecret)
      .update(raw)
      .digest('hex');

    const a = Buffer.from(signature);
    const b = Buffer.from(computed);

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    await this.queue.publish(QueueNames.WEBHOOK_EVENTS, body);

    return { status: 'ok' };
  }

  @Post('ebook/payment-confirmation')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Receber confirmação de pagamento do ebook e encaminhar ao back-ebook' })
  async handleEbookPaymentConfirmation(
    @Body() body: { orderNumber?: string; status?: string; email?: string; store?: string },
    @Headers('x-webhook-secret') secretHeader: string | undefined,
  ): Promise<{ status: string; forwarded: boolean }> {
    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (!expectedSecret || !secretHeader || secretHeader !== expectedSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    if (!body?.orderNumber || !body?.status) {
      throw new BadRequestException('orderNumber e status são obrigatórios');
    }

    const backEbookUrl = process.env.BACK_EBOOK_URL;
    const internalToken = process.env.API_MACHINE_INTERNAL_TOKEN;
    if (!backEbookUrl || !internalToken) {
      throw new InternalServerErrorException('BACK_EBOOK_URL/API_MACHINE_INTERNAL_TOKEN não configurados');
    }

    const endpoint = `${backEbookUrl.replace(/\/+$/, '')}/webhook/payment-confirmation`;
    this.logger.log(
      `[ebook/payment-confirmation] Encaminhando para back-ebook url=${endpoint} orderNumber=${body.orderNumber} status=${body.status} tokenLen=${internalToken.length}`,
    );
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': internalToken,
      },
      body: JSON.stringify({
        orderNumber: body.orderNumber,
        status: body.status,
        email: body.email,
        store: body.store || 'ebook',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `[ebook/payment-confirmation] back-ebook falhou status=${response.status} body=${text.slice(0, 800)}`,
      );
      throw new BadRequestException(`Falha ao encaminhar webhook para back-ebook: ${response.status} ${text}`);
    }

    this.logger.log('[ebook/payment-confirmation] Encaminhamento OK');
    return { status: 'ok', forwarded: true };
  }
}
