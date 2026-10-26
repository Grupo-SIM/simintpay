import { Body, Controller, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QUEUE_SERVICE } from '../../../core/services/queue.interface';
import type { IQueueService } from '../../../core/services/queue.interface';
import { QueueNames } from '../../../infrastructure/queue/queue-names';

@Controller('webhook')
@ApiTags('Webhook')
export class MasterWebhookController {
  private readonly logger = new Logger(MasterWebhookController.name);

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
  ) {}

  @Post('master')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Receber webhooks DOM da conta master/admin' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  async handle(@Body() body: unknown): Promise<{ status: string }> {
    await this.queueService.publish(QueueNames.DOM_WEBHOOK_DIRECT, body);
    return { status: 'ok' };
  }
}
