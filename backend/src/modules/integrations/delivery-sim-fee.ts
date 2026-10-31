import { UnprocessableEntityException } from '@nestjs/common';
import type { DeliveryFeeMode } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { loadFinancialPolicy } from '../financial-policy/financial-policy.service';
import { listPlatformSurcharges } from '../additive-fees/additive-fees.service';
import type { EffectiveFee } from '../additive-fees/additive-fee-calculation';
import type { DeliverySimFee } from './delivery-payment-allocation';

/** The platform's mode, read at charge time so the platform (never the caller) dictates the fees. */
export async function loadDeliveryFeeMode(
  prisma: Pick<PrismaService, 'platform'>,
  tag: string,
): Promise<DeliveryFeeMode> {
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { deliveryFeeMode: true },
  });
  return platform?.deliveryFeeMode ?? 'SIMINTPAY_ONLY';
}

/**
 * The `sim` fee of the first (alphabetical) acquirer lane for this method/installments, matching what
 * `readDeliveryFees` shows. Only loaded when the mode actually deducts SimIntPay fees.
 */
export async function loadDeliverySimFee(
  prisma: PrismaService,
  tag: string,
  feeMode: DeliveryFeeMode,
  method: 'PIX' | 'CREDIT_CARD',
  installments: number,
): Promise<DeliverySimFee | undefined> {
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { deliveryDisabledLanes: true },
  });
  if (platform?.deliveryDisabledLanes?.includes(`${method}/${installments}`))
    throw new UnprocessableEntityException({
      code: 'PAYMENT_LANE_DISABLED',
      lane: `${method}/${installments}`,
    });
  if (feeMode === 'ADDITIVE_ONLY') return undefined;
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

/** Additive fees associated with the platform; only needed when the allocation carries order lines. */
export async function loadDeliverySurcharges(
  prisma: PrismaService,
  tag: string,
  allocation: { items?: unknown[] },
  feeMode: DeliveryFeeMode,
): Promise<EffectiveFee[]> {
  if (!allocation.items || feeMode === 'SIMINTPAY_ONLY') return [];
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { id: true },
  });
  return platform ? listPlatformSurcharges(prisma, platform.id) : [];
}
