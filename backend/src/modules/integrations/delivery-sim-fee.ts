import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { loadFinancialPolicy } from '../financial-policy/financial-policy.service';
import type { DeliveryAllocationDto } from './integration-checkout.dto';
import type { DeliverySimFee } from './delivery-payment-allocation';

/**
 * The `sim` fee of the first (alphabetical) acquirer lane for this method/installments, matching what
 * `readDeliveryFees` shows. Only loaded when the mode actually deducts SimIntPay fees.
 */
export async function loadDeliverySimFee(
  prisma: PrismaService,
  tag: string,
  allocation: Pick<DeliveryAllocationDto, 'feeMode'>,
  method: 'PIX' | 'CREDIT_CARD',
  installments: number,
): Promise<DeliverySimFee | undefined> {
  if ((allocation.feeMode ?? 'ADDITIVE_ONLY') === 'ADDITIVE_ONLY')
    return undefined;
  const { document } = await loadFinancialPolicy(prisma, tag);
  for (const key of Object.keys(document.lanes).sort()) {
    const [, laneMethod, channel, n] = key.split('/');
    if (
      laneMethod === method &&
      channel === 'ONLINE' &&
      Number(n) === installments
    ) {
      const { fixedCents, ratePpm } = document.lanes[key]!.sim;
      return { fixedCents, ratePpm };
    }
  }
  return undefined;
}
