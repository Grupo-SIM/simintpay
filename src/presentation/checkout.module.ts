import { Module } from '@nestjs/common';
import { CheckoutController } from './controllers/checkout.controller';

@Module({
  controllers: [CheckoutController],
})
export class CheckoutModule {}
