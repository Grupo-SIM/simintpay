import { BadRequestException } from '@nestjs/common';
import { loadChargePolicy, quoteFinancialCharge } from './financial-charge';
import type { Method } from './financial-policy';

export async function requireFinancialCharge(
  prisma: Parameters<typeof loadChargePolicy>[0],
  tag: string,
  amount: number,
  method: Method,
) {
  const quote = quoteFinancialCharge(
    await loadChargePolicy(prisma, tag),
    amount,
    method,
    1,
  );
  if (!quote)
    throw new BadRequestException(
      'Política financeira não configurada para esta modalidade',
    );
  return quote;
}
