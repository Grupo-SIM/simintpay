import type { ModuleConfig } from '../module-config.interface';
import {
  resolveWithdrawalFixedFee,
  getPlatformTaxaEffective,
  syncedAcquirerRate,
} from '../platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../platform-taxas/platform-taxas.keys';
import { cartaoMdrProxy } from '../platform-taxas/cartao-mdr-proxy';

const TAG = 'EBOOK';

/**
 * Taxa fixa por venda do EbookSim (R$), cadastrada pelo admin — a mesma exibida em
 * admin.ebooksim.com/taxa (transactionFeeBrl). Líquido do vendedor = netAmount (% LIQUIDEZ) − esta taxa.
 */
export function getEbookTaxaServico(): number {
  return getPlatformTaxaEffective(
    TAG,
    'TAXA_SERVICO',
    PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
  );
}

export const EbookSimConfig: ModuleConfig = {
  name: 'EbookSim',
  slug: 'ebooksim',

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
