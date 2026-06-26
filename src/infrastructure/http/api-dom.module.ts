import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import {
  PAYMENT_GATEWAY,
  PAYMENT_GATEWAY_DOM,
  PAYMENT_GATEWAY_FRENDZ,
} from '../../core/services/payment-gateway.interface';
import { ApiDomClient } from './api-dom.client';
import { FrendzClient } from './frendz.client';
import { FrendzProductService } from './frendz-product.service';
import { PaymentGatewayResolver } from './payment-gateway.resolver';

/**
 * Módulo de gateways de pagamento (múltiplas adquirentes).
 *
 * Retrocompat: `PAYMENT_GATEWAY` continua sendo o ApiDomClient — os ~40 pontos
 * que injetam esse token NÃO mudam e seguem falando com a DOM.
 *
 * Novos: `PAYMENT_GATEWAY_DOM` / `PAYMENT_GATEWAY_FRENDZ` expõem cada client, e
 * o `PaymentGatewayResolver` escolhe entre eles por loja/tenant. Use-cases que
 * precisam rotear (PIX v1) injetam o resolver.
 */
@Module({
  imports: [HttpModule],
  providers: [
    ApiDomClient,
    FrendzClient,
    FrendzProductService,
    PaymentGatewayResolver,
    // Token histórico → DOM (inalterado para os consumidores existentes).
    { provide: PAYMENT_GATEWAY, useExisting: ApiDomClient },
    // Tokens por adquirente.
    { provide: PAYMENT_GATEWAY_DOM, useExisting: ApiDomClient },
    { provide: PAYMENT_GATEWAY_FRENDZ, useExisting: FrendzClient },
  ],
  exports: [
    PAYMENT_GATEWAY,
    PAYMENT_GATEWAY_DOM,
    PAYMENT_GATEWAY_FRENDZ,
    PaymentGatewayResolver,
  ],
})
export class ApiDomModule {}
