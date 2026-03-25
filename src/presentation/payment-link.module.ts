import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { PaymentLinkController } from './controllers/payment-link.controller';
import { CreatePaymentLinkUseCase } from '../application/use-cases/payment-link/create-payment-link.use-case';
import { ListPaymentLinksUseCase } from '../application/use-cases/payment-link/list-payment-links.use-case';
import { GetPaymentLinkUseCase } from '../application/use-cases/payment-link/get-payment-link.use-case';
import { UpdatePaymentLinkUseCase } from '../application/use-cases/payment-link/update-payment-link.use-case';
import { DeletePaymentLinkUseCase } from '../application/use-cases/payment-link/delete-payment-link.use-case';
import { PAYMENT_LINK_REPOSITORY } from '../core/repositories/payment-link.repository.interface';
import { PrismaPaymentLinkRepository } from '../infrastructure/database/repositories/prisma-payment-link.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [PaymentLinkController],
  providers: [
    CreatePaymentLinkUseCase,
    ListPaymentLinksUseCase,
    GetPaymentLinkUseCase,
    UpdatePaymentLinkUseCase,
    DeletePaymentLinkUseCase,
    { provide: PAYMENT_LINK_REPOSITORY, useClass: PrismaPaymentLinkRepository },
  ],
})
export class PaymentLinkModule {}
