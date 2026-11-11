import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';
import type { ModuleConfig } from '../module-config.interface';
import {
  resolveWithdrawalFixedFee,
  getPlatformTaxaEffective,
  syncedAcquirerRate,
} from '../platform-taxas/platform-taxas.store';
import { cartaoMdrProxy } from '../platform-taxas/cartao-mdr-proxy';

const TAG = 'FRENDZ';

/** Provider API URL remains an infrastructure default; credentials are scoped to a registered platform. */
export const FRENDZ_API_BASE_URL = 'https://api.frendz.com.br/api/public/v1';

export function getFrendzApiToken(slug?: string | null): string | null {
  return getPlatformIntegrationValue(slug ?? 'FRENDZ', 'FRENDZ_TOKEN');
}

export const FrendzConfig: ModuleConfig = {
  name: 'Frendz',
  slug: 'frendz',

  saque: {
    get minValor() {
      return getPlatformTaxaEffective(TAG, 'SAQUE_MIN', 100);
    },
    get taxaFixa() {
      return resolveWithdrawalFixedFee(TAG);
    },
    get taxaPercentual() {
      return getPlatformTaxaEffective(TAG, 'TAXA_SAQUE_PERCENT', 0);
    },
    get fatorLiquidez() {
      return getPlatformTaxaEffective(TAG, 'LIQUIDEZ', 0.91);
    },

    calcularTaxa(valorBruto: number) {
      return this.taxaFixa + valorBruto * this.taxaPercentual;
    },
    calcularLiquido(valorBruto: number) {
      return valorBruto - this.calcularTaxa(valorBruto);
    },
  },

  mdr: {
    get pix() {
      return syncedAcquirerRate('PIX', 'ONLINE', 1);
    },
    cartao: cartaoMdrProxy(),
    get taxaFixaPorTransacao() {
      return getPlatformTaxaEffective(TAG, 'TAXA_FIXA_TRANSACAO', 1.0);
    },
  },

  limites: {
    saldoMaximo: null,
    saqueMaximo: null,
    saquesPendentesMax: 1,
  },
};
