import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { QUEUE_SERVICE } from '../../../core/services/queue.interface';
import { RabbitMqService } from '../rabbitmq.service';
import { QueueNames } from '../queue-names';
import { ProcessWebhookUseCase } from '../../../application/use-cases/webhook/process-webhook.use-case';

@Injectable()
export class WebhookConsumer implements OnModuleInit {
  private readonly logger = new Logger(WebhookConsumer.name);

  constructor(
    private readonly processWebhook: ProcessWebhookUseCase,
    @Inject(QUEUE_SERVICE) private readonly queue: RabbitMqService,
  ) {}

  onModuleInit(): void {
    this.queue.register(QueueNames.WEBHOOK_EVENTS, async (payload) => {
      await this.processWebhook.execute({ payload: payload as Record<string, unknown> });
    });
    this.logger.log('[WebhookConsumer] Ouvindo fila bff-webhook-events');
  }
}
