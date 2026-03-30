import { Body, Controller, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QUEUE_SERVICE } from '../../../core/services/queue.interface';
import type { IQueueService } from '../../../core/services/queue.interface';
import { QueueNames } from '../../../infrastructure/queue/queue-names';

@Controller('webhook')
@ApiTags('Webhook')
export class RenovadaWebhookController {
  private readonly logger = new Logger(RenovadaWebhookController.name);

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
  ) {}

  @Post('renovada')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Receber webhooks DOM diretos da Renovada' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  async handle(@Body() body: unknown): Promise<{ status: string }> {
    await this.queueService.publish(QueueNames.DOM_WEBHOOK_DIRECT, body);
    return { status: 'ok' };
  }
}
