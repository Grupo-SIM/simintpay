import { Prisma } from '@prisma/client';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

/**
 * Líquido do vendedor (netAmount armazenado na transação).
 *
 * PIX:
 *   netAmount = amount × LIQUIDEZ
 *   Ex: taxa 10% → LIQUIDEZ 0,90 → R$1,00 × 0,90 = R$0,90.
 *   A taxa DOM (MDR_PIX) é absorvida pela plataforma dentro do corte (1 − LIQUIDEZ).
 *
 * Cartão/débito (planos PIX e links):
 *   netAmount = amount − (amount × TAXA_LINK_PERCENT + TAXA_LINK_FIXA)
 *   Ex: 6,99% + R$4,00 → R$1,00 − (R$0,07 + R$4,00) = −R$3,07.
 *   Ambos configuráveis no admin-card-machine (TAXA_LINK_PERCENT e TAXA_LINK_FIXA).
 */
export function calculateSellerNetValue(
  amountReais: number,
  _installments: number = 1,
  tenantTag: string = 'GLOBAL',
  paymentMethodHint?: string | null,
): Prisma.Decimal {
  const tag = tenantTag.toUpperCase();
  const pm = String(paymentMethodHint ?? 'pix').toLowerCase();
  const isCardLike = pm.includes('card') || pm.includes('credit') || pm.includes('debit');

  if (isCardLike) {
    // Vendedor paga: amount × TAXA_LINK_PERCENT + TAXA_LINK_FIXA (ambos configuráveis)
    const sellFeePercent = getPlatformTaxaEffective(tag, 'TAXA_LINK_PERCENT', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT);
    const sellFeeFixed = getPlatformTaxaEffective(tag, 'TAXA_LINK_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA);
    const calculatedNet = amountReais * (1 - sellFeePercent) - sellFeeFixed;
    return new Prisma.Decimal(calculatedNet);
  }

  // PIX: vendedor recebe exatamente amount × LIQUIDEZ
  const factor = getPlatformTaxaEffective(tag, 'LIQUIDEZ', PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
  const calculatedNet = amountReais * factor;
  return new Prisma.Decimal(calculatedNet);
}
