import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE } from '../../../core/services/queue.interface';
import { notifyZeroGrauPaymentStatus, type ZeroGrauPaymentStatusWebhook } from '../../../modules/zero-grau/services/zero-grau-webhook-notifier';
import { RabbitMqService } from '../rabbitmq.service';
import { QueueNames } from '../queue-names';

@Injectable()
export class ZeroGrauNotificationConsumer implements OnModuleInit {
  constructor(@Inject(QUEUE_SERVICE) private readonly queue: RabbitMqService) {}

  onModuleInit(): void {
    this.queue.register(QueueNames.ZERO_GRAU_NOTIFICATIONS, async (payload) => {
      const result = await notifyZeroGrauPaymentStatus(payload as ZeroGrauPaymentStatusWebhook);
      if (result === 'failed') throw new Error('Zero Grau payment notification failed');
    });
  }
}
