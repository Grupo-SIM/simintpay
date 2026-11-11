import type { PaymentMethod } from '@prisma/client';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../financial-policy/financial-charge';
import type { Method } from '../financial-policy/financial-policy';

type Prisma = Parameters<typeof loadChargePolicy>[0];

const MAX_SEARCH_CENTS = 100_000_00;
const WHOLE_REAL_CENTS = 100;

/**
 * Menor valor (centavos, à vista, canal online) em que a venda cobre o custo da adquirente e
 * deixa margem SimIntPay não negativa: líquido do vendedor > 0 e `platformProfit` >= 0. Retorna 0
 * quando a política ou o custo da modalidade não está configurado (sem piso a calcular).
 */
function minimumForMethod(
  context: Awaited<ReturnType<typeof loadChargePolicy>>,
  method: Method,
): number {
  const viable = (cents: number) => {
    try {
      const quote = quoteFinancialCharge(context, cents / 100, method, 1);
      return !!quote && quote.netAmount > 0 && quote.platformProfit >= 0;
    } catch {
      return false;
    }
  };
  if (!viable(MAX_SEARCH_CENTS)) return 0;
  let low = 1;
  let high = MAX_SEARCH_CENTS;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (viable(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Piso de uma oferta: maior piso entre os meios aceitos, arredondado para reais inteiros. Cada
 * piso sai do custo da adquirente (fixo + percentual) mais a taxa SimIntPay da política
 * financeira, nunca de um valor fixo no código.
 */
export async function offerMinimumCents(
  prisma: Prisma,
  platformTag: string | null,
  methods: readonly PaymentMethod[],
): Promise<number> {
  if (!methods.length) return 0;
  const context = await loadChargePolicy(prisma, platformTag ?? 'GLOBAL');
  const floor = Math.max(
    0,
    ...methods.map((method) => minimumForMethod(context, method)),
  );
  return Math.ceil(floor / WHOLE_REAL_CENTS) * WHOLE_REAL_CENTS;
}
