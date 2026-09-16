import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { ZeroGrauModule } from '../zero-grau/zero-grau.module';
import { IntegrationFinanceController } from './integration-finance.controller';
import { IntegrationFinanceService } from './integration-finance.service';
import { IntegrationWebhookWorker } from './integration-webhook.worker';

@Module({
  imports: [PrismaModule, ZeroGrauModule],
  controllers: [IntegrationFinanceController],
  providers: [IntegrationFinanceService, IntegrationWebhookWorker],
  exports: [IntegrationFinanceService],
})
export class IntegrationFinanceModule {}
