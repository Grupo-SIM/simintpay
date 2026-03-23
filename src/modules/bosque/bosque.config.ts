import type { ModuleConfig } from '../module-config.interface';

export const BosqueConfig: ModuleConfig = {
  name: 'Bosque',
  slug: 'bosque',

  saque: {
    minValor: Number(process.env.BOSQUE_SAQUE_MIN || 100),
    taxaFixa: Number(process.env.BOSQUE_TAXA_SAQUE_FIXA || 2),
    taxaPercentual: Number(process.env.BOSQUE_TAXA_SAQUE_PERCENT || 0),
    fatorLiquidez: Number(process.env.BOSQUE_LIQUIDEZ || 0.91),

    calcularTaxa(valorBruto) {
      return this.taxaFixa + valorBruto * this.taxaPercentual;
    },
    calcularLiquido(valorBruto) {
      return valorBruto - this.calcularTaxa(valorBruto);
    },
  },

  mdr: {
    pix: Number(process.env.BOSQUE_MDR_PIX || 0.0098),
    cartao: {
      1:  Number(process.env.BOSQUE_MDR_CC_1X || 0.0399),
      2:  Number(process.env.BOSQUE_MDR_CC_2X || 0.0830),
      3:  Number(process.env.BOSQUE_MDR_CC_3X || 0.0968),
      4:  Number(process.env.BOSQUE_MDR_CC_4X || 0.1104),
      5:  Number(process.env.BOSQUE_MDR_CC_5X || 0.1237),
      6:  Number(process.env.BOSQUE_MDR_CC_6X || 0.1367),
      7:  Number(process.env.BOSQUE_MDR_CC_7X || 0.1495),
      8:  Number(process.env.BOSQUE_MDR_CC_8X || 0.1621),
      9:  Number(process.env.BOSQUE_MDR_CC_9X || 0.1744),
      10: Number(process.env.BOSQUE_MDR_CC_10X || 0.1864),
      11: Number(process.env.BOSQUE_MDR_CC_11X || 0.1983),
      12: Number(process.env.BOSQUE_MDR_CC_12X || 0.2099),
    },
    taxaFixaPorTransacao: Number(process.env.BOSQUE_TAXA_FIXA_TRANSACAO || 1.00),
  },

  limites: {
    saldoMaximo: null,
    saqueMaximo: null,
    saquesPendentesMax: 1,
  },
};
