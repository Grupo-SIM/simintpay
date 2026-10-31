import { Global, Module } from '@nestjs/common';
import { PaymentCircuitBreaker } from './payment-circuit-breaker';

@Global()
@Module({
  providers: [PaymentCircuitBreaker],
  exports: [PaymentCircuitBreaker],
})
export class PaymentCircuitModule {}
