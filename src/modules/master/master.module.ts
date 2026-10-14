import { Module } from '@nestjs/common';
import { MasterWebhookController } from './controllers/master-webhook.controller';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MasterWebhookController],
  providers: [],
})
export class MasterModule {}
