import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  calculatePlatformFees,
  type EffectiveFee,
} from '../additive-fees/additive-fee-calculation';
import type { DeliveryAllocationDto } from './integration-checkout.dto';

/** Trusted internal contract. General/public checkouts cannot override financial policies. */
export function deliveryAllocation(
  integrationKey: string,
  allocation?: DeliveryAllocationDto,
): DeliveryAllocationDto | undefined {
  if (!integrationKey.startsWith('sim-delivery_')) {
    if (allocation !== undefined)
      throw new BadRequestException(
        'Divisão exclusiva da integração Sim Delivery',
      );
    return undefined;
  }
  if (
    !allocation ||
    !Number.isSafeInteger(allocation.merchantAmountCents) ||
    allocation.merchantAmountCents < 0 ||
    !Number.isSafeInteger(allocation.platformFeeCents) ||
    allocation.platformFeeCents < 0
  ) {
    throw new BadRequestException(
      'Divisão Sim Delivery obrigatória em centavos inteiros não negativos',
    );
  }
  const hasBreakdown =
    allocation.itemsAmountCents !== undefined ||
    allocation.deliveryAmountCents !== undefined;
  if (
    hasBreakdown &&
    (!Number.isSafeInteger(allocation.itemsAmountCents) ||
      allocation.itemsAmountCents! < 0 ||
      !Number.isSafeInteger(allocation.deliveryAmountCents) ||
      allocation.deliveryAmountCents! < 0 ||
      allocation.itemsAmountCents! + allocation.deliveryAmountCents! !==
        allocation.merchantAmountCents)
  )
    throw new BadRequestException({
      code: 'COPRODUCTION_BASE_INVALID',
      message: 'Detalhamento comercial inválido',
    });
  return {
    ...(hasBreakdown
      ? {
          itemsAmountCents: allocation.itemsAmountCents,
          deliveryAmountCents: allocation.deliveryAmountCents,
        }
      : {}),
    // Plain objects so the frozen snapshot stays JSON-serializable.
    ...(allocation.items
      ? {
          items: allocation.items.map((item) => ({
            key: item.key,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
          })),
        }
      : {}),
    merchantAmountCents: allocation.merchantAmountCents,
    platformFeeCents: allocation.platformFeeCents,
  };
}

/**
 * Delivery platforms only carry additive fees in SimIntPay. The buyer total is already final (merchant share plus the
 * additive surcharge Delivery priced): no interest, liquidity, SimIntPay fee or target fee is added or deducted, so the
 * merchant receives exactly `merchantAmountCents` and the surcharge is platform revenue. The acquirer cost is booked
 * separately by the caller.
 */
export function quoteAllocationCharge(
  price: number,
  allocation: DeliveryAllocationDto,
  surcharges: EffectiveFee[] = [],
) {
  const valid = deliveryAllocation('sim-delivery_quote', allocation)!;
  const total = valid.merchantAmountCents + valid.platformFeeCents;
  const cents = new Prisma.Decimal(price).mul(100);
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !cents.isInteger() ||
    !cents.equals(total)
  ) {
    throw new BadRequestException(
      'Total da cobrança difere da divisão Sim Delivery',
    );
  }
  // With order lines SimIntPay is the source of truth for the surcharge: recompute it from the platform's effective additive
  // totals (two synthetic fees) instead of trusting the caller. Without lines the legacy trusted `platformFeeCents` applies.
  if (valid.items) {
    const expected = calculatePlatformFees(
      surcharges,
      valid.items.map((item) => ({
        key: item.key,
        quantity: item.quantity,
        unitPrice: item.unitPriceCents,
      })),
    ).feeTotalCents;
    if (expected !== valid.platformFeeCents)
      throw new ConflictException({
        code: 'FEE_MISMATCH',
        message: 'As taxas aditivas mudaram; recalcule o pedido',
        expectedPlatformFeeCents: expected,
      });
  }
  return {
    totalAmount: total / 100,
    netAmount: valid.merchantAmountCents / 100,
    totalFeeAmount: valid.platformFeeCents / 100,
    domFeeAmount: 0,
    financialSnapshot: {
      contract: 'SIM_DELIVERY_ALLOCATION_V1',
      totalAmountCents: total,
      ...valid,
      // Plain objects so the frozen snapshot stays JSON-serializable.
      items: valid.items?.map((item) => ({
        key: item.key,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
    },
  };
}

/** Identifies the frozen Delivery contract without reinterpreting historical policies. */
export function isDeliveryAllocationSnapshot(snapshot: unknown): boolean {
  return (
    !!snapshot &&
    typeof snapshot === 'object' &&
    !Array.isArray(snapshot) &&
    'contract' in snapshot &&
    snapshot.contract === 'SIM_DELIVERY_ALLOCATION_V1'
  );
}
