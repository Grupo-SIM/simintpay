import { getRegisteredPlatform } from '../../../modules/module.registry';
import type { PaymentLink } from '@prisma/client';
import { getPlatformTaxaEffective, getCustomerInterestRate } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

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
 * Padrão: 9% + R$4,00
 */
function getSellerFeePercentage(platformTag?: string, installments = 1): number {
  return getPlatformTaxaEffective(
    platformTag ?? 'GLOBAL',
    `LINK_COST_${installments}X`,
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

/** Customer interest is owned by the platform; standalone 1x remains interest-free. */
export function getPlatformFeeRate(link: PaymentLink, installments: number, platformTag?: string): number {
  const isStandalone = (link as any).isStandalone ?? true;
  const shouldApply = isStandalone ? installments > 1 : true;
  if (!shouldApply) return 0;

  const n = Math.min(Math.max(installments, 1), 12);
  const tag = platformTag ?? (link as any).platformTag ?? 'GLOBAL';

  return getCustomerInterestRate(tag, n) * 100;
}



/**
 * Calcula o breakdown completo de taxas para um link de pagamento, espelhando
 * exatamente o cálculo do api-dom / admin-master.
 *
 * Fluxo:
 * 1. Juros da plataforma (platformFee%) aplicados sobre o valor BASE
 * 2. Taxa DOM aplicada sobre (base + juros)
 * 3. Valor total que o COMPRADOR paga = base + juros + taxaDom + fixedDom
 * 4. Líquido = total cobrado − custo DOM calculado − taxa vendedor (9% + R$4)
 */
export function calculatePaymentLinkFees(
  link: PaymentLink,
  installments: number,
  platformTag?: string,
  isPix = false,
  absorbInterest = false,
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
  transactionFixedFee: number;
  cashbackFee: number;
  netAmount: number;
  estimatedMargin: number;
  negativeMargin: boolean;
} {
  const n = Math.min(Math.max(installments, 1), 12);
  absorbInterest = absorbInterest || !!getRegisteredPlatform(platformTag)?.absorbCustomerInterest;
  const baseAmount = Number(link.amount);

  // 1. Juros da plataforma sobre o valor base — PIX nunca tem juros para o comprador
  const platformFeeRate = isPix ? 0 : getPlatformFeeRate(link, n, platformTag);
  const interestAmount = (baseAmount * platformFeeRate) / 100;
  const valueWithInterest = baseAmount + interestAmount;

  // 2. Taxa DOM sobre o valor com juros
  const domFeeRate = DOM_FEE_RATES[n] ?? 0;
  const domFixedFee = getDomFixedFee(n);
  const domFeeAmount = valueWithInterest * domFeeRate + domFixedFee;

  // 3. Total que o COMPRADOR paga
  const totalAmount = isPix || absorbInterest ? baseAmount : valueWithInterest + domFeeAmount;
  const installmentAmount = totalAmount / n;

  // 4. Líquido do VENDEDOR (calculado sobre o valor BASE, com taxa fixa multiplicada por parcelas)
  const cashbackFee = 0;
  const transactionFixedFee = 0;
  const sellerFee = baseAmount * getSellerFeePercentage(platformTag, n) + getSellerFeeFixed(platformTag);
  const netAmount = totalAmount - (isPix ? 0 : domFeeAmount) - sellerFee;
  const estimatedMargin = netAmount - baseAmount;

  return {
    estimatedMargin: round2(estimatedMargin),
    negativeMargin: estimatedMargin < 0,
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
    transactionFixedFee: round2(transactionFixedFee),
    cashbackFee,
    netAmount: round2(netAmount),
  };
}

/**
 * Taxa da DOM para débito: 3,49% + R$1,00 (fixa).
 */
const DOM_DEBIT_FEE_PERCENT = 3.49;
const DOM_DEBIT_FEE_FIXED = 1.00;

/**
 * Calcula o breakdown de taxas para pagamento com CARTÃO DE DÉBITO.
 *
 * Regra de negócio:
 * - O COMPRADOR paga exatamente o valor base (link.amount) — sem acréscimo.
 * - O VENDEDOR arca com: DOM (3,49% + R$1,00) + Taxa plataforma (TAXA_DEBITO_PERCENT + TAXA_DEBITO_FIXA).
 * - As taxas de plataforma são configuradas por plataforma em /admin/taxas; defaults: 2% + R$2,00.
 */
export function calculateDebitFees(
  link: PaymentLink,
  platformTag?: string,
): {
  baseAmount: number;
  domFeePercent: number;
  domFeeFixed: number;
  domFeeAmount: number;
  platformFeePercent: number;
  platformFeeFixed: number;
  platformFeeAmount: number;
  transactionFixedFee: number;
  cashbackFee: number;
  totalFeeAmount: number;
  netAmount: number;
} {
  const baseAmount = Number(link.amount);
  const domFeeAmount = baseAmount * (DOM_DEBIT_FEE_PERCENT / 100) + DOM_DEBIT_FEE_FIXED;

  const tag = platformTag ?? 'GLOBAL';
  const platformFeeDecimal = getPlatformTaxaEffective(tag, 'TAXA_DEBITO_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_DEBITO_PERCENT);
  const platformFeeFixed = getPlatformTaxaEffective(tag, 'TAXA_DEBITO_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_DEBITO_FIXA);
  const transactionFixedFee = getPlatformTaxaEffective(tag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
  const cashbackFee = getPlatformTaxaEffective(tag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
  const platformFeePercent = platformFeeDecimal * 100;
  const platformFeeAmount = baseAmount * platformFeeDecimal + platformFeeFixed;

  const totalFeeAmount = domFeeAmount + platformFeeAmount + transactionFixedFee + cashbackFee;
  const netAmount = baseAmount - totalFeeAmount;

  return {
    baseAmount,
    domFeePercent: DOM_DEBIT_FEE_PERCENT,
    domFeeFixed: DOM_DEBIT_FEE_FIXED,
    domFeeAmount: round2(domFeeAmount),
    platformFeePercent,
    platformFeeFixed,
    platformFeeAmount: round2(platformFeeAmount),
    transactionFixedFee: round2(transactionFixedFee),
    cashbackFee: round2(cashbackFee),
    totalFeeAmount: round2(totalFeeAmount),
    netAmount: round2(netAmount),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
