import { UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { listPlatformSurcharges } from '../additive-fees/additive-fees.service';
import type { EffectiveFee } from '../additive-fees/additive-fee-calculation';

/** SimIntPay rejects charges in lanes the platform does not accept. */
export async function assertPaymentLaneEnabled(
  prisma: Pick<PrismaService, 'platform'>,
  tag: string,
  method: 'PIX' | 'CREDIT_CARD',
  installments: number,
) {
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { disabledPaymentLanes: true },
  });
  if (platform?.disabledPaymentLanes?.includes(`${method}/${installments}`))
    throw new UnprocessableEntityException({
      code: 'PAYMENT_LANE_DISABLED',
      lane: `${method}/${installments}`,
    });
}

/**
 * Two synthetic fees from the platform's additive totals; only needed when the allocation carries order lines.
 * `SIMINTPAY_ONLY` platforms have no additive fees, so a surcharge sent for them is a mismatch.
 */
export async function loadDeliverySurcharges(
  prisma: PrismaService,
  tag: string,
  allocation: { items?: unknown[] },
): Promise<EffectiveFee[]> {
  if (!allocation.items) return [];
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { id: true, feeMode: true },
  });
  return platform && platform.feeMode !== 'SIMINTPAY_ONLY'
    ? listPlatformSurcharges(prisma, platform.id)
    : [];
}
