import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { BillingService } from '../../application/use-cases/billing/billing.service';
import { SubscriptionWebhookService } from '../../application/use-cases/subscription/subscription-webhook.service';

@Controller()
@ApiTags('Assinantes')
export class SubscriptionController {
  constructor(
    private readonly subscriptionWebhook: SubscriptionWebhookService,
    private readonly billing: BillingService,
    private readonly jwt: JwtService,
  ) {}

  // ── Webhook público para recorrência (postback do gateway) ─────────────
  @Post('subscription/webhook')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Webhook de assinatura (postback do gateway)' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  async handleSubscriptionWebhook(
    @Body() body: Record<string, unknown>,
  ): Promise<{ status: string }> {
    const data = body.data as Record<string, unknown> | undefined;
    const relations = data?.relations as Record<string, unknown> | undefined;
    const event = String(body.event ?? '')
      .replace(/\s+/g, '')
      .toUpperCase();
    const subscriptionId =
      typeof relations?.id_subscriber === 'string'
        ? relations.id_subscriber
        : event.startsWith('SIGNATURE-') && typeof data?.id === 'string'
          ? data.id
          : undefined;
    const signature =
      typeof body.signature === 'string' ? body.signature : undefined;
    if (!subscriptionId || !signature)
      throw new UnauthorizedException('Webhook DOM inválido');
    const token =
      (await this.billing.getDomWebhookToken(subscriptionId)) ??
      process.env.DOM_TOKEN;
    if (!token) throw new UnauthorizedException('Webhook DOM não configurado');
    try {
      await this.jwt.verifyAsync(signature, {
        secret: token,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Assinatura DOM inválida');
    }
    const paymentId = typeof data?.id === 'string' ? data.id : undefined;
    const amount =
      typeof data?.amount === 'number' ? data.amount / 100 : undefined;
    const mapped =
      event.includes('INVOICE-PAID') || event === 'CHARGE-APPROVED'
        ? 'PAID'
        : event.includes('INVOICE-FAILED') ||
            event === 'CHARGE-NOT_AUTHORIZED' ||
            event === 'CHARGE-EXPIRE'
          ? 'FAILED'
          : event === 'SIGNATURE-CANCELLED'
            ? 'CANCELLED'
            : undefined;
    if (mapped)
      await this.billing.applyWorkspacePaymentEvent({
        subscriptionId,
        eventKey: `dom:${signature}`,
        event: mapped,
        paymentId,
        amount,
      });
    await this.subscriptionWebhook.handleWebhook(body);
    return { status: 'ok' };
  }
}
