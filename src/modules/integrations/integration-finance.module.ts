import { JwtModule } from '@nestjs/jwt';
import { EmailService } from '../../infrastructure/email/email.service';
import { ProvisionDeliveryOwnerService } from './provision-delivery-owner.service';
import { WebhookModule } from '../../presentation/webhook.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { IntegrationPaymentService } from './integration-payment.service';
import { IntegrationFinanceController } from './integration-finance.controller';
import { IntegrationFinanceService } from './integration-finance.service';
import { IntegrationWebhookWorker } from './integration-webhook.worker';

@Module({
  imports: [PrismaModule, WebhookModule, JwtModule.register({})],
  controllers: [IntegrationFinanceController],
  providers: [ProvisionDeliveryOwnerService, EmailService, IntegrationFinanceService, IntegrationWebhookWorker, IntegrationPaymentService],
  exports: [IntegrationFinanceService],
})
export class IntegrationFinanceModule {}
