import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  FEE_SCOPES,
  totalsToFees,
  type AdditiveTotals,
  type EffectiveFee,
} from './additive-fee-calculation';

type Client = Pick<Prisma.TransactionClient, 'platformAdditiveTotals'>;

export type AdditiveFeesView = {
  delivery: AdditiveTotals;
  override: AdditiveTotals | null;
  effective: AdditiveTotals;
};

const MAX_PERCENTAGE_BPS = 10_000;
const MAX_FIXED_CENTS = 2_147_483_647;

export const zeroTotals = (): AdditiveTotals => ({
  order: { percentageValue: 0, fixedValue: 0 },
  product: { percentageValue: 0, fixedValue: 0 },
});

const isInt = (value: unknown, max: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max;

/** Validates AdditiveTotals; throws BadRequestException when malformed. */
export function validateAdditiveTotals(input: unknown): AdditiveTotals {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Taxas aditivas inválidas');
  const raw = input as Record<string, unknown>;
  const result = zeroTotals();
  for (const scope of FEE_SCOPES) {
    const part = raw[scope] as Record<string, unknown> | undefined;
    if (!part || typeof part !== 'object')
      throw new BadRequestException('Escopo de taxa aditiva inválido');
    if (!isInt(part.percentageValue, MAX_PERCENTAGE_BPS))
      throw new BadRequestException('Percentual de taxa aditiva inválido');
    if (!isInt(part.fixedValue, MAX_FIXED_CENTS))
      throw new BadRequestException('Valor fixo de taxa aditiva inválido');
    result[scope] = {
      percentageValue: part.percentageValue,
      fixedValue: part.fixedValue,
    };
  }
  return result;
}

/** Delivery total, optional override and effective total (override ?? delivery) for the platform. */
export async function readAdditiveFees(
  tx: Client,
  platformId: string,
): Promise<AdditiveFeesView> {
  const row = await tx.platformAdditiveTotals.findUnique({
    where: { platformId },
  });
  if (!row) {
    return { delivery: zeroTotals(), override: null, effective: zeroTotals() };
  }
  const delivery: AdditiveTotals = {
    order: {
      percentageValue: row.deliveryOrderPct,
      fixedValue: row.deliveryOrderFixed,
    },
    product: {
      percentageValue: row.deliveryProductPct,
      fixedValue: row.deliveryProductFixed,
    },
  };
  const override =
    row.overrideOrderPct === null ||
    row.overrideOrderFixed === null ||
    row.overrideProductPct === null ||
    row.overrideProductFixed === null
      ? null
      : ({
          order: {
            percentageValue: row.overrideOrderPct,
            fixedValue: row.overrideOrderFixed,
          },
          product: {
            percentageValue: row.overrideProductPct,
            fixedValue: row.overrideProductFixed,
          },
        } satisfies AdditiveTotals);
  return { delivery, override, effective: override ?? delivery };
}

/** The two synthetic fees (order, product) for the platform's effective totals. */
export async function listPlatformSurcharges(
  tx: Client,
  platformId: string,
): Promise<EffectiveFee[]> {
  return totalsToFees((await readAdditiveFees(tx, platformId)).effective);
}

/** Sets the Delivery total; never touches the override. */
export async function setDeliveryTotals(
  tx: Client,
  platformId: string,
  totals: AdditiveTotals,
) {
  const data = {
    deliveryOrderPct: totals.order.percentageValue,
    deliveryOrderFixed: totals.order.fixedValue,
    deliveryProductPct: totals.product.percentageValue,
    deliveryProductFixed: totals.product.fixedValue,
  };
  await tx.platformAdditiveTotals.upsert({
    where: { platformId },
    create: { platformId, ...data },
    update: data,
  });
}

/** Sets (AdditiveTotals) or clears (null) the admin override; never touches the Delivery total. */
export async function setOverrideTotals(
  tx: Client,
  platformId: string,
  totals: AdditiveTotals | null,
) {
  const data = {
    overrideOrderPct: totals?.order.percentageValue ?? null,
    overrideOrderFixed: totals?.order.fixedValue ?? null,
    overrideProductPct: totals?.product.percentageValue ?? null,
    overrideProductFixed: totals?.product.fixedValue ?? null,
  };
  await tx.platformAdditiveTotals.upsert({
    where: { platformId },
    create: { platformId, ...data },
    update: data,
  });
}
