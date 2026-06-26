import type { ModuleConfig } from '../module-config.interface';
import { getPlatformTaxaEffective } from '../platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../platform-taxas/platform-taxas.keys';
import { cartaoMdrProxy } from '../platform-taxas/cartao-mdr-proxy';

const TAG = 'FRENDZ';

/**
 * URL base da API pública da Frendz. Sobrescrevível por env para apontar a um
 * ambiente de teste, se a Frendz oferecer um.
 */
export const FRENDZ_API_BASE_URL = (
  process.env.FRENDZ_API_URL ?? 'https://api.frendz.com.br/api/public/v1'
).replace(/\/$/, '');

/**
 * Resolve o `api_token` da Frendz. O token é por CONTA Frendz, então uma loja
 * pode ter o seu próprio (`{SLUG}_FRENDZ_TOKEN`) ou cair no token global
 * (`FRENDZ_API_TOKEN`). NUNCA hard-coded — sempre via env.
 *
 * @param slug slug da loja/tenant (ex.: 'renovada'); null usa só o global.
 */
export function getFrendzApiToken(slug?: string | null): string | null {
  if (slug) {
    const scoped = process.env[`${slug.toUpperCase()}_FRENDZ_TOKEN`];
    if (scoped && scoped.length > 0) return scoped;
  }
  const global = process.env.FRENDZ_API_TOKEN;
  return global && global.length > 0 ? global : null;
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
