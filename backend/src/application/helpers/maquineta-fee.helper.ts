import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';
import {
  estimatePhysicalDomFeeReais,
  isPhysicalDebit,
} from './dom-fee-estimate.helper';

/** Taxas de uma venda física (maquineta / POS). */
export type MaquinetaFees = {
  /** Taxa % da Sim Int Pay aplicada (POS_TAXA_*_PERCENT). */
  simIntRate: number;
  /** Valor em R$ que a Sim Int Pay cobra do cliente. */
  platformFeeAmt: number;
  /**
   * Líquido do cliente. Com POS_ABSORVER_TAXAS ligado (padrão): bruto − taxa
   * Sim Int Pay (o MDR da DOM NÃO é descontado dele). Desligado: também
   * desconta o custo DOM.
   */
  netAmount: number;
  /** Custo DOM da venda física — abatido da margem Sim Int Pay (ou do lojista, se o toggle estiver desligado). */
  domFeeAmt: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Chave da taxa Sim Int Pay física conforme o método de pagamento da DOM.
 * No crédito a taxa é POR PARCELA (POS_TAXA_CREDITO_{N}X), porque o custo DOM
 * cresce com o parcelamento — mesmo padrão do MDR_CC_MASTER nas vendas online.
 */
export function posTaxaKeyForPaymentMethod(
  paymentMethodRaw: string | null | undefined,
  installments?: number | null,
  cardBrandRaw?: string | null,
): string {
  const pm = String(paymentMethodRaw ?? '').toLowerCase();
  if (isPhysicalDebit(paymentMethodRaw, cardBrandRaw))
    return 'POS_TAXA_DEBITO_PERCENT';
  if (pm.includes('card') || pm.includes('credit')) {
    const inst = Math.min(Math.max(Number(installments ?? 1) || 1, 1), 12);
    return `POS_TAXA_CREDITO_${inst}X`;
  }
  return 'POS_TAXA_PIX_PERCENT';
}

/**
 * Taxas de uma venda física, resolvidas pela aba /admin/taxas da plataforma.
 *
 *   líquido do cliente = bruto × (1 − taxa Sim Int Pay do método/parcela)
 *   custo DOM          = tabela de custos sincronizada (canal POS)
 *   lucro Sim Int Pay  = taxa Sim Int Pay − custo DOM
 *
 * Por padrão (POS_ABSORVER_TAXAS = 1) o custo DOM sai da margem da Sim Int Pay,
 * nunca do cliente — por isso o `netAmount` não desconta o `domFee` e
 * `totalFee` ≠ (bruto − netAmount). Com o toggle desligado (0), o custo DOM
 * também é descontado do repasse ao lojista.
 * O `liquid_amount` que a DOM devolve serve só de referência do custo dela.
 */
export function calculateMaquinetaFees(
  platformTag: string,
  amountReais: number,
  paymentMethodRaw: string | null | undefined,
  installments: number | null | undefined,
  /** Bandeira do cartão — única forma de distinguir débito de crédito no POS. */
  cardBrandRaw?: string | null,
): MaquinetaFees {
  const amount = Number(amountReais) || 0;
  const key = posTaxaKeyForPaymentMethod(
    paymentMethodRaw,
    installments,
    cardBrandRaw,
  );

  const simIntRate = getPlatformTaxaEffective(
    platformTag,
    key,
    (PLATFORM_TAXA_DEFAULTS as Record<string, number>)[key],
  );

  const platformFeeAmt = round2(amount * simIntRate);
  const domFeeAmt = estimatePhysicalDomFeeReais({
    amountReais: amount,
    paymentMethod: paymentMethodRaw,
    installments,
    tenantTag: platformTag,
    cardBrand: cardBrandRaw,
  }).total;

  // Toggle "Absorver taxas de maquineta" (aba admin/taxas → Vendas Físicas):
  // 1 (default) = custo DOM sai da margem Sim Int Pay, lojista recebe (bruto − taxa Sim Int Pay).
  // 0 = custo DOM é descontado do repasse ao lojista também.
  const absorve =
    getPlatformTaxaEffective(platformTag, 'POS_ABSORVER_TAXAS', 1) !== 0;
  const netAmount = absorve
    ? round2(amount - platformFeeAmt)
    : round2(amount - platformFeeAmt - domFeeAmt);

  return { simIntRate, platformFeeAmt, netAmount, domFeeAmt };
}
