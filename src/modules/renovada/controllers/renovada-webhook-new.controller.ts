import { Controller, Post, Body, HttpCode, Inject } from '@nestjs/common';
import { ApiTags, ApiExcludeController } from '@nestjs/swagger';
import { QUEUE_SERVICE } from '../../../core/services/queue.interface';
import type { IQueueService } from '../../../core/services/queue.interface';
import { QueueNames } from '../../../infrastructure/queue/queue-names';

@ApiTags('Renovada Webhooks')
@ApiExcludeController()
@Controller('renovada/webhook')
export class RenovadaWebhookNewController {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
  ) {}

  @Post('/dom')
  @HttpCode(200)
  async domWebhook(@Body() body: unknown): Promise<{ status: string }> {
    await this.queueService.publish(QueueNames.DOM_WEBHOOK_DIRECT, body);
    return { status: 'ok' };
  }

  @Post('/')
  @HttpCode(200)
  async webhook(@Body() body: unknown): Promise<{ status: string }> {
    await this.queueService.publish(QueueNames.DOM_WEBHOOK_DIRECT, body);
    return { status: 'ok' };
  }
}
