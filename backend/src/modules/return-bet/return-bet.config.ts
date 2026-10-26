import type { ModuleConfig } from '../module-config.interface';
import { PLATFORM_TAXA_DEFAULTS } from '../platform-taxas/platform-taxas.keys';

export const ReturnBetConfig: ModuleConfig = {
  name: 'Return Bet',
  slug: 'return-bet',
  saque: {
    minValor: 100,
    taxaFixa: 2,
    taxaPercentual: 0,
    fatorLiquidez: 1,
    calcularTaxa(valorBruto: number) {
      return this.taxaFixa + valorBruto * this.taxaPercentual;
    },
    calcularLiquido(valorBruto: number) {
      return valorBruto - this.calcularTaxa(valorBruto);
    },
  },
  mdr: {
    pix: PLATFORM_TAXA_DEFAULTS.MDR_PIX,
    cartao: {},
    taxaFixaPorTransacao: PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
  },
  limites: {
    saldoMaximo: null,
    saqueMaximo: null,
    saquesPendentesMax: 1,
  },
};
