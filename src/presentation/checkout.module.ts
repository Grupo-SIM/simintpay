import { Module } from '@nestjs/common';
import { CheckoutController } from './controllers/checkout.controller';
import { InternalEbookFinanceController } from './controllers/internal-ebook-finance.controller';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';

@Module({
  imports: [ApiDomModule],
  controllers: [CheckoutController, InternalEbookFinanceController],
})
export class CheckoutModule {}
