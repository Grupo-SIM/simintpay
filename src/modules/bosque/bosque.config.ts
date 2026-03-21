import type { ModuleConfig } from '../module-config.interface';

export const BosqueConfig: ModuleConfig = {
  name: 'Bosque',
  slug: 'bosque',

  saque: {
    minValor: 100,
    taxaFixa: 2,
    taxaPercentual: 0,

    calcularTaxa(valorBruto) {
      return this.taxaFixa + valorBruto * this.taxaPercentual;
    },
    calcularLiquido(valorBruto) {
      return valorBruto - this.calcularTaxa(valorBruto);
    },
  },

  mdr: {
    pix: 0.0098,
    cartao: {
      1:  0.0399,
      2:  0.0830,
      3:  0.0968,
      4:  0.1104,
      5:  0.1237,
      6:  0.1367,
      7:  0.1495,
      8:  0.1621,
      9:  0.1744,
      10: 0.1864,
      11: 0.1983,
      12: 0.2099,
    },
    taxaFixaPorTransacao: 1.00,
  },

  limites: {
    saldoMaximo: null,
    saqueMaximo: null,
    saquesPendentesMax: 1,
  },
};
