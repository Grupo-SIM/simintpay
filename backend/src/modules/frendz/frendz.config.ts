import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';
import type { ModuleConfig } from '../module-config.interface';
import { getPlatformTaxaEffective } from '../platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../platform-taxas/platform-taxas.keys';
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
      return getPlatformTaxaEffective(TAG, 'TAXA_SAQUE_FIXA', 2);
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
      return getPlatformTaxaEffective(TAG, 'MDR_PIX', PLATFORM_TAXA_DEFAULTS.MDR_PIX);
    },
    cartao: cartaoMdrProxy(TAG),
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
