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
 * A taxa de serviço por venda deixou de existir no EbookSim: a taxa efetiva é só a da plataforma (já embutida no
 * netAmount). Vendas criadas antes deste instante tiveram a taxa deduzida do crédito, então ela segue valendo para
 * elas, para o saldo reconstruído continuar igual ao crédito real. Ajuste ao horário real do deploy se divergir.
 */
export const EBOOK_TAXA_SERVICO_ENDS_AT = new Date('2026-11-19T03:00:00.000Z');

/** Taxa fixa por venda (R$) aplicável a uma venda criada em `createdAt`: 0 a partir do corte. */
export function getEbookTaxaServico(createdAt: Date = new Date()): number {
  if (createdAt >= EBOOK_TAXA_SERVICO_ENDS_AT) return 0;
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
