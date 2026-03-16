import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../core/services/payment-gateway.interface';
import { ApiDomClient } from './api-dom.client';

@Module({
  imports: [HttpModule],
  providers: [{ provide: PAYMENT_GATEWAY, useClass: ApiDomClient }],
  exports: [PAYMENT_GATEWAY],
})
export class ApiDomModule {}
