import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { connect, type AmqpConnectionManager } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { QueueNames } from '../queue-names';
import { ProcessWebhookUseCase } from '../../../application/use-cases/webhook/process-webhook.use-case';

@Injectable()
export class WebhookConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookConsumer.name);
  private connection: AmqpConnectionManager | null = null;

  constructor(private readonly processWebhook: ProcessWebhookUseCase) {}

  onModuleInit(): void {
    this.connection = connect([
      process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',
    ]);

    const channelWrapper = this.connection.createChannel({
      setup: async (channel: ConfirmChannel) => {
        await channel.assertQueue(QueueNames.WEBHOOK_EVENTS, { durable: true });
        await channel.prefetch(10);

        await channel.consume(
          QueueNames.WEBHOOK_EVENTS,
          (msg: ConsumeMessage | null) => {
            if (!msg) return;
            void this.handleMessage(channel, msg);
          },
          { noAck: false },
        );
      },
    });

    void channelWrapper;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.logger.log('RabbitMQ consumer connection closed');
    }
  }

  private async handleMessage(
    channel: ConfirmChannel,
    msg: ConsumeMessage,
  ): Promise<void> {
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<
        string,
        unknown
      >;
      if (payload && typeof payload === 'object') {
        await this.processWebhook.execute({ payload });
      }
      channel.ack(msg);
    } catch (error) {
      this.logger.error(
        `Failed to process webhook message: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      // NACK with requeue=false to send to dead letter queue (if configured) instead of infinite retry
      channel.nack(msg, false, false);
    }
  }
}
