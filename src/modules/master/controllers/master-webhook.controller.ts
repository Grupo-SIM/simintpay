import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MasterWebhookService } from '../services/master-webhook.service';

@Controller('webhook')
@ApiTags('Webhook')
export class MasterWebhookController {
  private readonly logger = new Logger(MasterWebhookController.name);

  constructor(private readonly webhookService: MasterWebhookService) {}

  @Post('master')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Receber webhooks DOM da conta master/admin' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  async handle(@Body() body: unknown): Promise<{ status: string }> {
    await this.webhookService.process(body);
    return { status: 'ok' };
  }
}
