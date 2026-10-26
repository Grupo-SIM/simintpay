import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { QUEUE_SERVICE } from '../../../core/services/queue.interface';
import { RabbitMqService } from '../rabbitmq.service';
import { QueueNames } from '../queue-names';
import { ProcessDomWebhookUseCase } from '../../../application/use-cases/webhook/process-dom-webhook.use-case';

@Injectable()
export class DomWebhookConsumer implements OnModuleInit {
  private readonly logger = new Logger(DomWebhookConsumer.name);

  constructor(
    private readonly processDomWebhook: ProcessDomWebhookUseCase,
    @Inject(QUEUE_SERVICE) private readonly queue: RabbitMqService,
  ) {}

  onModuleInit(): void {
    this.queue.register(QueueNames.DOM_WEBHOOK_DIRECT, async (payload) => {
      await this.processDomWebhook.execute(payload);
    }, true);
    this.logger.log('[DomWebhookConsumer] Ouvindo fila dom-webhook-direct');
  }
}
