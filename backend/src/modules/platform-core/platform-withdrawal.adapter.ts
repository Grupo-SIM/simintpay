import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getPlatformTaxaEffective } from '../platform-taxas/platform-taxas.store';

/** Canonical input is gross cents. Ebook/Pagatg historically price fees on the net payout. */
export function platformWithdrawalQuote(tag: string, gross: Prisma.Decimal, merchant = false) {
  const fixed = new Prisma.Decimal(getPlatformTaxaEffective(tag, 'TAXA_SAQUE_FIXA', 2));
  const rate = new Prisma.Decimal(tag === 'AREAFLIX' ? 0 : getPlatformTaxaEffective(tag, 'TAXA_SAQUE_PERCENT', 0));
  const minimum = new Prisma.Decimal(getPlatformTaxaEffective(tag, 'SAQUE_MIN', 100));
  if (!fixed.isFinite() || fixed.isNegative() || !rate.isFinite() || rate.isNegative() || !minimum.isFinite() || minimum.isNegative()) throw new BadRequestException('Configuração de saque inválida');
  const netBasis = !merchant && (tag === 'EBOOK' || tag === 'PAGATG');
  const fee = netBasis ? gross.minus(gross.minus(fixed).div(rate.plus(1)).toDecimalPlaces(2)) : fixed.plus(gross.mul(rate)).toDecimalPlaces(2);
  const amount = gross.minus(fee);
  if ((netBasis ? amount : gross).lt(minimum)) throw new BadRequestException('Valor inferior ao saque mínimo');
  if (amount.lte(0)) throw new BadRequestException('Valor insuficiente para cobrir taxa');
  return { amount, grossAmount: gross, fee };
}
