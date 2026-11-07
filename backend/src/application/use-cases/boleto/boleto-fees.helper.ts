import {
  getPlatformTaxaEffective,
  syncedAcquirerCostReais,
} from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Taxas do boleto (valores FIXOS em R$ por boleto pago), por plataforma.
 *
 * Modelo INCLUSIVO (igual PIX/saque): o comprador paga o valor base; o vendedor
 * arca com a taxa SimIntPay (TAXA_BOLETO_FIXA + TAXA_BOLETO_TRANSACAO). O custo DOM
 * (tabela sincronizada da adquirente) é DESMEMBRADO para exibição/relatório,
 * mas já está contido na taxa SimIntPay (lucro SimIntPay = taxa SimIntPay − custo DOM).
 */
export function calculateBoletoFees(
  baseAmount: number,
  platformTag?: string,
): {
  baseAmount: number;
  /** Taxa total cobrada do vendedor (SimIntPay). */
  platformFeeTotal: number;
  /** Custo DOM desmembrado (contido no total). */
  domFeeAmount: number;
  /** Lucro efetivo SimIntPay = total − DOM. */
  platformProfit: number;
  /** Líquido que o vendedor recebe. */
  netAmount: number;
  simFixa: number;
  simTransacao: number;
  domFixa: number;
  domTransacao: number;
} {
  const tag = platformTag ?? 'GLOBAL';
  const simFixa = getPlatformTaxaEffective(
    tag,
    'TAXA_BOLETO_FIXA',
    PLATFORM_TAXA_DEFAULTS.TAXA_BOLETO_FIXA,
  );
  const simTransacao = getPlatformTaxaEffective(
    tag,
    'TAXA_BOLETO_TRANSACAO',
    PLATFORM_TAXA_DEFAULTS.TAXA_BOLETO_TRANSACAO,
  );
  // Custo sincronizado (MDR fixo + tarifa por transação já somados na tabela da adquirente).
  const domFixa = syncedAcquirerCostReais(
    'BOLETO',
    'ONLINE',
    1,
    baseAmount,
  ).total;
  const domTransacao = 0;

  const platformFeeTotal = round2(simFixa + simTransacao);
  const domFeeAmount = round2(domFixa + domTransacao);
  const platformProfit = round2(platformFeeTotal - domFeeAmount);
  const netAmount = round2(baseAmount - platformFeeTotal);

  return {
    baseAmount: round2(baseAmount),
    platformFeeTotal,
    domFeeAmount,
    platformProfit,
    netAmount,
    simFixa,
    simTransacao,
    domFixa,
    domTransacao,
  };
}
