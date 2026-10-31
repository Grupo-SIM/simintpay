import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DELIVERY_FEE_MODES,
  type DeliveryAllocationDto,
} from './integration-checkout.dto';

/** SimIntPay's own fee for a lane, charged on the buyer total and deducted from the merchant share. */
export type DeliverySimFee = { fixedCents: number; ratePpm: number };

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
  if (
    allocation.feeMode !== undefined &&
    !DELIVERY_FEE_MODES.includes(allocation.feeMode)
  )
    throw new BadRequestException('Modo de taxa inválido');
  const feeMode = allocation.feeMode ?? 'ADDITIVE_ONLY';
  if (feeMode === 'SIMINTPAY_ONLY' && allocation.platformFeeCents !== 0)
    throw new BadRequestException(
      'Modo somente SimIntPay não admite taxa aditiva',
    );
  return {
    feeMode,
    ...(hasBreakdown
      ? {
          itemsAmountCents: allocation.itemsAmountCents,
          deliveryAmountCents: allocation.deliveryAmountCents,
        }
      : {}),
    merchantAmountCents: allocation.merchantAmountCents,
    platformFeeCents: allocation.platformFeeCents,
  };
}

/**
 * Buyer total is already final. No interest, liquidity or processing charge is added to it. In SIMINTPAY_ONLY and
 * BOTH modes SimIntPay's own `sim` fee (never `owner` or acquirer terms) is deducted from the merchant share.
 */
export function quoteDeliveryCharge(
  price: number,
  allocation: DeliveryAllocationDto,
  sim?: DeliverySimFee,
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
  const deducts = valid.feeMode !== 'ADDITIVE_ONLY';
  if (deducts && !sim)
    throw new BadRequestException({
      code: 'DELIVERY_SIM_FEE_UNCONFIGURED',
      message: 'Taxas SimIntPay não configuradas para esta modalidade',
    });
  const simFeeCents = deducts
    ? sim!.fixedCents +
      new Prisma.Decimal(total)
        .mul(sim!.ratePpm)
        .div(1_000_000)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toNumber()
    : 0;
  if (simFeeCents > valid.merchantAmountCents)
    throw new BadRequestException({
      code: 'DELIVERY_SIM_FEE_EXCEEDS_MERCHANT',
      message: 'Taxa SimIntPay maior que o valor da empresa',
    });
  return {
    totalAmount: total / 100,
    netAmount: (valid.merchantAmountCents - simFeeCents) / 100,
    totalFeeAmount: (valid.platformFeeCents + simFeeCents) / 100,
    domFeeAmount: 0,
    simFeeAmount: simFeeCents / 100,
    financialSnapshot: {
      contract: 'SIM_DELIVERY_ALLOCATION_V1',
      totalAmountCents: total,
      simFeeCents,
      ...valid,
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
