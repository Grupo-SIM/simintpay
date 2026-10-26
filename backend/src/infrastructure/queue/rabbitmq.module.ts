import { Global, Module } from '@nestjs/common';
import { QUEUE_SERVICE } from '../../core/services/queue.interface';
import { RabbitMqService } from './rabbitmq.service';

@Global()
@Module({
  providers: [{ provide: QUEUE_SERVICE, useClass: RabbitMqService }],
  exports: [QUEUE_SERVICE],
})
export class RabbitMqModule {}
