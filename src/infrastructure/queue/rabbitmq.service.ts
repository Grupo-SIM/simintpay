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
  private readonly fallbacks = new Map<string, (message: unknown) => Promise<void>>();
  private readonly publisher = this.connection.createChannel({ confirm: true });

  constructor() {
    this.connection.on('connect', () => this.logger.log('[RabbitMQ] connected'));
    this.connection.on('disconnect', () => this.logger.error('[RabbitMQ] disconnected; DOM webhooks use local processing'));
    this.connection.on('connectFailed', () => this.logger.error('[RabbitMQ] connection failed; check broker availability and credentials'));
  }

  async publish(queue: string, message: unknown): Promise<void> {
    const fallback = this.fallbacks.get(queue);
    if (fallback && !this.connection.isConnected()) {
      this.logger.warn(`[RabbitMQ] local processing: queue=${queue} reason=disconnected`);
      await fallback(message);
      return;
    }
    try {
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
    } catch (error) {
      if (!fallback) throw error;
      this.logger.warn(`[RabbitMQ] local processing: queue=${queue} reason=publish-failed`);
      // A timed-out publish may still arrive later. Only idempotent handlers opt in.
      await fallback(message);
    }
  }

  register(queue: string, handler: (message: unknown) => Promise<void>, localFallback = false): void {
    if (localFallback) this.fallbacks.set(queue, handler);
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
