import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { connect, type ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import type { IQueueService } from '../../core/services/queue.interface';

@Injectable()
export class RabbitMqService implements IQueueService, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private readonly connection = connect([process.env.RABBITMQ_URL ?? 'amqp://localhost:5672']);
  private readonly queues = new Map<string, Promise<void>>();
  private readonly consumers: ChannelWrapper[] = [];
  private readonly publisher = this.connection.createChannel({ confirm: true });

  async publish(queue: string, message: unknown): Promise<void> {
    if (!this.queues.has(queue)) {
      const setup = this.publisher.addSetup(async (channel: ConfirmChannel) => {
        await channel.assertQueue(queue, { durable: true });
      });
      this.queues.set(queue, setup);
    }
    await this.queues.get(queue);
    await this.publisher.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      timeout: 10_000,
    });
  }

  register(queue: string, handler: (message: unknown) => Promise<void>): void {
    const consumer = this.connection.createChannel({
      setup: async (channel: ConfirmChannel) => {
        await channel.assertQueue(queue, { durable: true });
        await channel.assertQueue(`${queue}.failed`, { durable: true });
        // Preserve transaction ordering and wallet updates. Notifications use a separate queue.
        await channel.prefetch(1);
        await channel.consume(queue, async (message) => {
          if (!message) return;
          try {
            await handler(JSON.parse(message.content.toString()));
            channel.ack(message);
          } catch (error) {
            this.logger.error(`Webhook processing failed in ${queue}: ${error instanceof Error ? error.message : 'unknown error'}`);
            const attempts = Number(message.properties.headers?.['x-attempts'] ?? 0) + 1;
            try {
              await this.publisher.sendToQueue(attempts < 3 ? queue : `${queue}.failed`, message.content, {
                persistent: true,
                headers: { ...message.properties.headers, 'x-attempts': attempts },
                timeout: 10_000,
              });
              channel.ack(message);
            } catch {
              channel.nack(message, false, true);
            }
          }
        }, { noAck: false });
      },
    });
    this.consumers.push(consumer);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.close()));
    await this.publisher.close();
    await this.connection.close();
  }
}
