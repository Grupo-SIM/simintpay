import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { ApiTags, ApiExcludeController } from '@nestjs/swagger';
import { BosqueWebhookService } from '../services/bosque-webhook.service';

@ApiTags('Bosque Webhooks')
@ApiExcludeController()
@Controller('bosque/webhook')
export class BosqueWebhookController {
  constructor(private readonly webhookService: BosqueWebhookService) {}

  @Post('/dom')
  @HttpCode(200)
  async domWebhook(@Body() body: any) {
    this.webhookService['logger']?.log?.('[BOSQUE] Webhook DOM recebido');
    return await this.webhookService.processWebhook(body);
  }

  @Post('/')
  @HttpCode(200)
  async webhook(@Body() body: any, @Headers() headers: Record<string, string>) {
    const signature = headers['x-webhook-signature'] || body.signature;
    const payload = JSON.stringify(body);

    if (!this.webhookService.verifyWebhookSignature(payload, signature)) {
      throw new Error('Assinatura inválida');
    }

    return await this.webhookService.processWebhook(body);
  }
}
