import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import { connect } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import type { IQueueService } from '../../core/services/queue.interface';

@Injectable()
export class RabbitMqService implements IQueueService, OnModuleDestroy {
  private readonly connection = connect([
    process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',
  ]);

  private readonly channel: ChannelWrapper = this.connection.createChannel({
    setup: async (channel: ConfirmChannel) => {
      await channel.prefetch(10);
    },
  });

  async publish(queue: string, message: unknown): Promise<void> {
    await this.channel.assertQueue(queue, { durable: true });
    const payload = Buffer.from(JSON.stringify(message));
    await this.channel.sendToQueue(queue, payload, { persistent: true });
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
