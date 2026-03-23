import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RenovadaWebhookService } from '../services/renovada-webhook.service';

/**
 * Recebe webhooks diretos do gateway DOM para o módulo Renovada,
 * sem depender do api-dom como intermediário.
 *
 * Configure este endpoint como URL de webhook na conta DOM da Renovada:
 *   POST /webhook/renovada
 */
@Controller('webhook')
@ApiTags('Webhook')
export class RenovadaWebhookController {
  private readonly logger = new Logger(RenovadaWebhookController.name);

  constructor(private readonly webhookService: RenovadaWebhookService) {}

  @Post('renovada')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Receber webhooks DOM diretos da Renovada' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  async handle(@Body() body: unknown): Promise<{ status: string }> {
    await this.webhookService.process(body);
    return { status: 'ok' };
  }
}
