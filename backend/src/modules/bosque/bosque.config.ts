import type { ModuleConfig } from '../module-config.interface';
import {
  resolveWithdrawalFixedFee,
  getPlatformTaxaEffective,
  domCashbackReais,
  syncedAcquirerRate,
} from '../platform-taxas/platform-taxas.store';
import { cartaoMdrProxy } from '../platform-taxas/cartao-mdr-proxy';

const TAG = 'BOSQUE';

export const BosqueConfig: ModuleConfig = {
  name: 'Bosque',
  slug: 'bosque',

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
    get taxaCashback() {
      return domCashbackReais();
    },
  },

  limites: {
    saldoMaximo: null,
    saqueMaximo: null,
    saquesPendentesMax: 1,
  },
};
