import type { PaymentLink } from '@prisma/client';
import { getPlatformTaxaEffective, getPlatformTaxaSource } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS, type PlataformaTaxaKey } from '../../../modules/platform-taxas/platform-taxas.keys';

/**
 * Taxas da DOM por número de parcelas (cobradas do COMPRADOR sobre o valor com juros).
 */
const DOM_FEE_RATES: Record<number, number> = {
  1:  0.0000,  // 0,00%
  2:  0.0451,  // 4,51%
  3:  0.0604,  // 6,04%
  4:  0.0759,  // 7,59%
  5:  0.0915,  // 9,15%
  6:  0.1072,  // 10,72%
  7:  0.1231,  // 12,31%
  8:  0.1392,  // 13,92%
  9:  0.1554,  // 15,54%
  10: 0.1717,  // 17,17%
  11: 0.1882,  // 18,82%
  12: 0.2048,  // 20,48%
};

/**
 * Taxa fixa da DOM por parcela (R$1,00 para 2x+, R$0 para 1x).
 */
function getDomFixedFee(installments: number): number {
  return installments > 1 ? 1.0 : 0;
}

/**
 * Taxa do vendedor (casa): configurável via GLOBAL → plataforma.
 * Padrão: 6,99% + R$4,00
 */
function getSellerFeePercentage(platformTag?: string): number {
  return getPlatformTaxaEffective(
    platformTag ?? 'GLOBAL',
    'TAXA_LINK_PERCENT',
    PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT,
  );
}
function getSellerFeeFixed(platformTag?: string): number {
  return getPlatformTaxaEffective(
    platformTag ?? 'GLOBAL',
    'TAXA_LINK_FIXA',
    PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA,
  );
}

/**
 * Retorna a taxa de juros da plataforma (master) para um link de pagamento por
 * número de parcelas. Usa MDR_LINK_NX configurado por plataforma; fallback para
 * o campo platformFeeNx gravado no link (legado) se a taxa de plataforma for 0.
 *
 * Regra:
 * - isStandalone=true (Avulso): 1x sem juros (só DOM), 2x+ com juros da plataforma
 * - isStandalone=false (Plataforma): sempre com juros, incluindo 1x
 */
export function getPlatformFeeRate(link: PaymentLink, installments: number, platformTag?: string): number {
  const isStandalone = (link as any).isStandalone ?? true;
  const shouldApply = isStandalone ? installments > 1 : true;
  if (!shouldApply) return 0;

  const n = Math.min(Math.max(installments, 1), 12);
  const tag = platformTag ?? (link as any).platformTag ?? 'GLOBAL';
  const mdrKey = `MDR_LINK_${n}X` as PlataformaTaxaKey;

  // Usa MDR_LINK_NX somente se houver override explícito (env var ou storage).
  // Sem override, respeita o platformFeeNx gravado no link (legado / produção existente).
  const source = getPlatformTaxaSource(tag, mdrKey);
  if (source === 'override' || source === 'env') {
    const platformRate = getPlatformTaxaEffective(tag, mdrKey, PLATFORM_TAXA_DEFAULTS[mdrKey]);
    return platformRate * 100; // decimal → % (o caller divide por 100)
  }

  // Comportamento original: campo platformFeeNx gravado diretamente no link
  const legacyMap: Record<number, string> = {
    1: 'platformFee1x', 2: 'platformFee2x', 3: 'platformFee3x',
    4: 'platformFee4x', 5: 'platformFee5x', 6: 'platformFee6x',
    7: 'platformFee7x', 8: 'platformFee8x', 9: 'platformFee9x',
    10: 'platformFee10x', 11: 'platformFee11x', 12: 'platformFee12x',
  };
  return Number((link as any)[legacyMap[n]] ?? 0);
}



/**
 * Calcula o breakdown completo de taxas para um link de pagamento, espelhando
 * exatamente o cálculo do api-dom / admin-master.
 *
 * Fluxo:
 * 1. Juros da plataforma (platformFee%) aplicados sobre o valor BASE
 * 2. Taxa DOM aplicada sobre (base + juros)
 * 3. Valor total que o COMPRADOR paga = base + juros + taxaDom + fixedDom
 * 4. Valor líquido que o VENDEDOR recebe = base - (6,99% + R$4) - cashbackFee
 */
export function calculatePaymentLinkFees(
  link: PaymentLink,
  installments: number,
  platformTag?: string,
): {
  baseAmount: number;
  platformFeeRate: number;
  interestAmount: number;
  valueWithInterest: number;
  domFeeRate: number;
  domFeeAmount: number;
  domFixedFee: number;
  totalAmount: number;
  installmentAmount: number;
  sellerFee: number;
  cashbackFee: number;
  netAmount: number;
} {
  const n = Math.min(Math.max(installments, 1), 12);
  const baseAmount = Number(link.amount);

  // 1. Juros da plataforma sobre o valor base
  const platformFeeRate = getPlatformFeeRate(link, n, platformTag);
  const interestAmount = (baseAmount * platformFeeRate) / 100;
  const valueWithInterest = baseAmount + interestAmount;

  // 2. Taxa DOM sobre o valor com juros
  const domFeeRate = DOM_FEE_RATES[n] ?? 0;
  const domFixedFee = getDomFixedFee(n);
  const domFeeAmount = valueWithInterest * domFeeRate + domFixedFee;

  // 3. Total que o COMPRADOR paga
  const totalAmount = valueWithInterest + domFeeAmount;
  const installmentAmount = totalAmount / n;

  // 4. Líquido do VENDEDOR (calculado sobre o valor BASE, independente de parcelas)
  const cashbackFee = (link as any).cashbackFee ?? getPlatformTaxaEffective(platformTag ?? 'GLOBAL', 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
  const sellerFee = baseAmount * getSellerFeePercentage(platformTag) + getSellerFeeFixed(platformTag);
  const netAmount = baseAmount - sellerFee - cashbackFee;

  return {
    baseAmount,
    platformFeeRate,
    interestAmount: round2(interestAmount),
    valueWithInterest: round2(valueWithInterest),
    domFeeRate,
    domFeeAmount: round2(domFeeAmount),
    domFixedFee,
    totalAmount: round2(totalAmount),
    installmentAmount: round2(installmentAmount),
    sellerFee: round2(sellerFee),
    cashbackFee,
    netAmount: round2(netAmount),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
