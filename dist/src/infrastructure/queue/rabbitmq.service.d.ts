import { OnModuleDestroy } from '@nestjs/common';
import type { IQueueService } from '../../core/services/queue.interface';
export declare class RabbitMqService implements IQueueService, OnModuleDestroy {
    private readonly connection;
    private readonly channel;
    publish(queue: string, message: unknown): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
