import { Module } from '@nestjs/common';
import { PagatgWebhookController } from './pagatg-webhook.controller';

@Module({
  controllers: [PagatgWebhookController],
})
export class PagatgModule {}
