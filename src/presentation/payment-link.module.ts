import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { PaymentLinkController } from './controllers/payment-link.controller';
import { CreatePaymentLinkUseCase } from '../application/use-cases/payment-link/create-payment-link.use-case';
import { ListPaymentLinksUseCase } from '../application/use-cases/payment-link/list-payment-links.use-case';
import { GetPaymentLinkUseCase } from '../application/use-cases/payment-link/get-payment-link.use-case';
import { UpdatePaymentLinkUseCase } from '../application/use-cases/payment-link/update-payment-link.use-case';
import { DeletePaymentLinkUseCase } from '../application/use-cases/payment-link/delete-payment-link.use-case';
import { GetPublicPaymentLinkUseCase } from '../application/use-cases/payment-link/get-public-payment-link.use-case';
import { ChargePaymentLinkUseCase } from '../application/use-cases/payment-link/charge-payment-link.use-case';
import { PAYMENT_LINK_REPOSITORY } from '../core/repositories/payment-link.repository.interface';
import { PrismaPaymentLinkRepository } from '../infrastructure/database/repositories/prisma-payment-link.repository';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [PaymentLinkController],
  providers: [
    CreatePaymentLinkUseCase,
    ListPaymentLinksUseCase,
    GetPaymentLinkUseCase,
    UpdatePaymentLinkUseCase,
    DeletePaymentLinkUseCase,
    GetPublicPaymentLinkUseCase,
    ChargePaymentLinkUseCase,
    { provide: PAYMENT_LINK_REPOSITORY, useClass: PrismaPaymentLinkRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class PaymentLinkModule {}
