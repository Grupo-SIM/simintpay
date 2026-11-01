import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  FEE_SCOPES,
  totalsToFees,
  type AdditiveTotals,
  type EffectiveFee,
} from './additive-fee-calculation';

type Client = Pick<Prisma.TransactionClient, 'platformAdditiveFees'>;

export type AdditiveFeesView = {
  revision: string;
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

/** Generic platform totals and independent additive revision. */
export async function readAdditiveFees(
  tx: Client,
  platformId: string,
): Promise<AdditiveFeesView> {
  const row = await tx.platformAdditiveFees.findUnique({
    where: { platformId },
  });
  return {
    effective: row
      ? {
          order: { percentageValue: row.orderPct, fixedValue: row.orderFixed },
          product: {
            percentageValue: row.productPct,
            fixedValue: row.productFixed,
          },
        }
      : zeroTotals(),
    revision: String(row?.revision ?? 0),
  };
}

export async function listPlatformSurcharges(
  tx: Client,
  platformId: string,
): Promise<EffectiveFee[]> {
  return totalsToFees((await readAdditiveFees(tx, platformId)).effective);
}

/** Integration writers must supply the revision they read; admin writes are unconditional. */
export async function setAdditiveFees(
  tx: Client,
  platformId: string,
  totals: AdditiveTotals,
  expectedRevision?: string,
) {
  if (
    expectedRevision !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(expectedRevision) ||
      Number(expectedRevision) > 2_147_483_647)
  )
    throw new BadRequestException('Revisão de taxas aditivas inválida');
  const data = {
    orderPct: totals.order.percentageValue,
    orderFixed: totals.order.fixedValue,
    productPct: totals.product.percentageValue,
    productFixed: totals.product.fixedValue,
  };
  // Ensure a row exists before the guarded update, including concurrent first writes.
  await tx.platformAdditiveFees.upsert({
    where: { platformId },
    create: { platformId },
    update: {},
  });
  const result = await tx.platformAdditiveFees.updateMany({
    where: {
      platformId,
      ...(expectedRevision === undefined
        ? {}
        : { revision: Number(expectedRevision) }),
    },
    data: { ...data, revision: { increment: 1 } },
  });
  if (result.count !== 1)
    throw new ConflictException(
      'Taxas aditivas alteradas; recarregue e tente novamente',
    );
}
