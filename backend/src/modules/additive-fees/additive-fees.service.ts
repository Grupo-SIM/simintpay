import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  FEE_SCOPES,
  type EffectiveFee,
  type FeeScope,
} from './additive-fee-calculation';

type Client = Pick<Prisma.TransactionClient, 'platformAdditiveValue'>;

/** Resolved value pushed by SIM Delivery, which owns the catalog (names, associations, overrides). */
export type AdditiveValue = {
  externalId: string;
  name: string;
  applicationScope: FeeScope;
  percentageValue: number;
  fixedValue: number;
};

const MAX_PERCENTAGE_BPS = 10_000;
const MAX_FIXED_CENTS = 2_147_483_647;
export const MAX_ADDITIVE_VALUES = 500;

const isInt = (value: unknown, max: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max;

/** Validates a full replacement list; throws BadRequestException on any malformed item or duplicate externalId. */
export function validateAdditiveValues(input: unknown): AdditiveValue[] {
  if (!Array.isArray(input) || input.length > MAX_ADDITIVE_VALUES)
    throw new BadRequestException('Taxas aditivas inválidas');
  const seen = new Set<string>();
  return input.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const externalId =
      typeof item.externalId === 'string' ? item.externalId.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!externalId || externalId.length > 200 || seen.has(externalId))
      throw new BadRequestException('Taxa aditiva com identificador inválido');
    seen.add(externalId);
    if (!name || name.length > 120)
      throw new BadRequestException('Taxa aditiva com nome inválido');
    if (
      !(FEE_SCOPES as readonly string[]).includes(
        item.applicationScope as string,
      )
    )
      throw new BadRequestException('Escopo de taxa aditiva inválido');
    if (!isInt(item.percentageValue, MAX_PERCENTAGE_BPS))
      throw new BadRequestException('Percentual de taxa aditiva inválido');
    if (!isInt(item.fixedValue, MAX_FIXED_CENTS))
      throw new BadRequestException('Valor fixo de taxa aditiva inválido');
    return {
      externalId,
      name,
      applicationScope: item.applicationScope as FeeScope,
      percentageValue: item.percentageValue,
      fixedValue: item.fixedValue,
    };
  });
}

/** Stored values of one platform, in the order they were pushed. */
export async function listAdditiveValues(
  tx: Client,
  platformId: string,
): Promise<AdditiveValue[]> {
  const rows = await tx.platformAdditiveValue.findMany({
    where: { platformId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((row) => ({
    externalId: row.externalId,
    name: row.name,
    applicationScope: row.applicationScope as FeeScope,
    percentageValue: row.percentageValue,
    fixedValue: row.fixedValue,
  }));
}

/** Surcharges as the calculation consumes them (`id` = Delivery's fee id). */
export const toEffectiveFees = (values: AdditiveValue[]): EffectiveFee[] =>
  values.map((value) => ({
    id: value.externalId,
    name: value.name,
    applicationScope: value.applicationScope,
    percentageValue: value.percentageValue,
    fixedValue: value.fixedValue,
  }));

export async function listPlatformSurcharges(
  tx: Client,
  platformId: string,
): Promise<EffectiveFee[]> {
  return toEffectiveFees(await listAdditiveValues(tx, platformId));
}

/** Full replacement: the given list becomes the platform's whole set. */
export async function replaceAdditiveValues(
  tx: Client,
  platformId: string,
  values: AdditiveValue[],
) {
  await tx.platformAdditiveValue.deleteMany({ where: { platformId } });
  if (!values.length) return;
  await tx.platformAdditiveValue.createMany({
    data: values.map((value, sortOrder) => ({
      platformId,
      externalId: value.externalId,
      name: value.name,
      applicationScope: value.applicationScope,
      percentageValue: value.percentageValue,
      fixedValue: value.fixedValue,
      sortOrder,
    })),
  });
}
