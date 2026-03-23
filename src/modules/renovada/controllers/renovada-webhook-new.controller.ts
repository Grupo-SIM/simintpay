import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { ApiTags, ApiExcludeController } from '@nestjs/swagger';
import { WebhookService } from '../services/webhook.service';

@ApiTags('Renovada Webhooks')
@ApiExcludeController()
@Controller('renovada/webhook')
export class RenovadaWebhookNewController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('/dom')
  @HttpCode(200)
  async domWebhook(@Body() body: any) {
    console.log('🔔 [RENOVADA] WEBHOOK DOM RECEBIDO - POST /renovada/webhook/dom');
    console.log('📦 Payload:', JSON.stringify(body, null, 2));
    console.log('💳 PaymentId:', body.data?.id);
    console.log('💰 Status:', body.data?.status);

    return await this.webhookService.processWebhook(body);
  }

  @Post('/')
  @HttpCode(200)
  async webhook(@Body() body: any, @Headers() headers: Record<string, string>) {
    console.log('🔔 [RENOVADA] WEBHOOK RECEBIDO - POST /renovada/webhook');
    console.log('📦 Payload:', JSON.stringify(body, null, 2));
    console.log('📋 Signature:', body.signature);
    console.log('📋 Event:', body.event);
    console.log('💳 PaymentId:', body.data?.id);
    console.log('💰 Status:', body.data?.status);

    // Verificar assinatura se existir
    const signature = headers['x-webhook-signature'] || body.signature;
    const payload = JSON.stringify(body);
    
    if (!this.webhookService.verifyWebhookSignature(payload, signature)) {
      console.log('❌ [RENOVADA] Assinatura do webhook inválida');
      throw new Error('Assinatura inválida');
    }

    return await this.webhookService.processWebhook(body);
  }
}
