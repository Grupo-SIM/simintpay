import { Module } from '@nestjs/common';
import { MasterWebhookService } from './services/master-webhook.service';
import { MasterWebhookController } from './controllers/master-webhook.controller';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MasterWebhookController],
  providers: [MasterWebhookService],
})
export class MasterModule {}
