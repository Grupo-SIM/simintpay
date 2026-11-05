import { Acquirer } from './acquirer.enum';
import type { PaymentMethod } from '@prisma/client';

/**
 * O que cada adquirente executa. A SimIntPay é dona de planos e recorrência;
 * o adquirente só precisa executar cobranças avulsas. Uma oferta recorrente
 * automática exige `chargeStoredCard`; sem isso a renovação é paga pelo comprador.
 */
export type AcquirerCapabilities = {
  methods: ReadonlySet<PaymentMethod>;
  /** Parcelamento máximo no cartão (1 = só à vista). */
  maxInstallments: number;
  /** Cobra um cartão previamente salvo sem o comprador presente. */
  chargeStoredCard: boolean;
};

const CAPABILITIES: Record<Acquirer, AcquirerCapabilities> = {
  [Acquirer.DOM]: {
    methods: new Set<PaymentMethod>([
      'PIX',
      'CREDIT_CARD',
      'DEBIT_CARD',
      'BOLETO',
    ]),
    maxInstallments: 12,
    chargeStoredCard: true,
  },
  // Escopo v1 da Frendz: PIX ponta a ponta (ver FrendzClient).
  [Acquirer.FRENDZ]: {
    methods: new Set<PaymentMethod>(['PIX']),
    maxInstallments: 1,
    chargeStoredCard: false,
  },
};

export function acquirerCapabilities(acquirer: Acquirer): AcquirerCapabilities {
  return CAPABILITIES[acquirer] ?? CAPABILITIES[Acquirer.DOM];
}

/** Meios pedidos que o adquirente não executa; vazio quando a combinação é válida. */
export function unsupportedMethods(
  acquirer: Acquirer,
  requested: readonly PaymentMethod[],
): PaymentMethod[] {
  const { methods } = acquirerCapabilities(acquirer);
  return requested.filter((method) => !methods.has(method));
}
