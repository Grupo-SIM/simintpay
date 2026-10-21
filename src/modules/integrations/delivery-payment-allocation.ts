import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DeliveryAllocationDto } from './integration-checkout.dto';

/** Trusted internal contract. General/public checkouts cannot override financial policies. */
export function deliveryAllocation(integrationKey: string, allocation?: DeliveryAllocationDto): DeliveryAllocationDto | undefined {
  if (!integrationKey.startsWith('sim-delivery_')) {
    if (allocation !== undefined) throw new BadRequestException('Divisão exclusiva da integração Sim Delivery');
    return undefined;
  }
  if (!allocation || !Number.isSafeInteger(allocation.merchantAmountCents) || allocation.merchantAmountCents < 0
    || !Number.isSafeInteger(allocation.platformFeeCents) || allocation.platformFeeCents < 0) {
    throw new BadRequestException('Divisão Sim Delivery obrigatória em centavos inteiros não negativos');
  }
  return { merchantAmountCents: allocation.merchantAmountCents, platformFeeCents: allocation.platformFeeCents };
}

/** Buyer total is already final. No interest, liquidity or processing charge is added or deducted. */
export function quoteDeliveryCharge(price: number, allocation: DeliveryAllocationDto) {
  const valid = deliveryAllocation('sim-delivery_quote', allocation)!;
  const total = valid.merchantAmountCents + valid.platformFeeCents;
  const cents = new Prisma.Decimal(price).mul(100);
  if (!Number.isSafeInteger(total) || total <= 0 || !cents.isInteger() || !cents.equals(total)) {
    throw new BadRequestException('Total da cobrança difere da divisão Sim Delivery');
  }
  return {
    totalAmount: total / 100,
    netAmount: valid.merchantAmountCents / 100,
    totalFeeAmount: valid.platformFeeCents / 100,
    domFeeAmount: 0,
    financialSnapshot: { contract: 'SIM_DELIVERY_ALLOCATION_V1', totalAmountCents: total, ...valid },
  };
}
