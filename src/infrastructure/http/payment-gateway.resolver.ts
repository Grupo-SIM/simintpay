import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PAYMENT_GATEWAY_DOM,
  PAYMENT_GATEWAY_FRENDZ,
} from '../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { Acquirer, DEFAULT_ACQUIRER } from '../../core/services/acquirer.enum';
import { getModuleAcquirer } from '../../modules/module.registry';

/**
 * ──────────────────────────────────────────────────────────────────────────
 * PaymentGatewayResolver — escolhe a implementação de gateway por adquirente.
 *
 * É o ÚNICO lugar que conhece o mapa Acquirer → implementação concreta.
 * Recebe ambos os clients por DI (tokens dedicados) e os entrega sob demanda.
 *
 * Use:
 *   resolver.byAcquirer(Acquirer.FRENDZ)   // explícito
 *   resolver.bySlug('renovada')            // resolve via {SLUG}_ACQUIRER (env)
 * ──────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PaymentGatewayResolver {
  private readonly logger = new Logger(PaymentGatewayResolver.name);

  constructor(
    @Inject(PAYMENT_GATEWAY_DOM) private readonly dom: IPaymentGateway,
    @Inject(PAYMENT_GATEWAY_FRENDZ) private readonly frendz: IPaymentGateway,
  ) {}

  /** Implementação concreta para uma adquirente. */
  byAcquirer(acquirer: Acquirer): IPaymentGateway {
    switch (acquirer) {
      case Acquirer.FRENDZ:
        return this.frendz;
      case Acquirer.DOM:
      default:
        return this.dom;
    }
  }

  /** Gateway da loja/tenant, resolvido pela env {SLUG}_ACQUIRER (default DOM). */
  bySlug(slug: string | null | undefined): IPaymentGateway {
    const acquirer = getModuleAcquirer(slug);
    if (acquirer !== DEFAULT_ACQUIRER) {
      this.logger.log(`[Acquirer] loja "${slug}" → ${acquirer}`);
    }
    return this.byAcquirer(acquirer);
  }

  /** Qual adquirente uma loja usa (sem materializar o gateway). */
  acquirerForSlug(slug: string | null | undefined): Acquirer {
    return getModuleAcquirer(slug);
  }
}
