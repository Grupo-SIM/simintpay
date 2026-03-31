import { Module } from '@nestjs/common';
import { CheckoutController } from './controllers/checkout.controller';
import { InternalEbookFinanceController } from './controllers/internal-ebook-finance.controller';

@Module({
  controllers: [CheckoutController, InternalEbookFinanceController],
})
export class CheckoutModule {}
