import { Global, Module } from '@nestjs/common';
import { QUEUE_SERVICE } from '../../core/services/queue.interface';
import { InMemoryQueueService } from './in-memory-queue.service';

@Global()
@Module({
  providers: [{ provide: QUEUE_SERVICE, useClass: InMemoryQueueService }],
  exports: [QUEUE_SERVICE],
})
export class RabbitMqModule {}
