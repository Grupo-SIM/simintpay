import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AdditiveFee as AdditiveFeeRow, Prisma } from '@prisma/client';
import {
  FEE_DISPLAY_MODES,
  FEE_SCOPES,
  type EffectiveFee,
  type FeeDisplayMode,
  type FeeScope,
} from './additive-fee-calculation';

type Client = Pick<
  Prisma.TransactionClient,
  'additiveFee' | 'platformAdditiveFee'
>;

export type AdditiveFee = {
  id: string;
  name: string;
  applicationScope: FeeScope;
  displayMode: FeeDisplayMode;
  percentageValue: number;
  fixedValue: number;
  active: boolean;
};

export type CompanyAdditiveFee = AdditiveFee & {
  associated: boolean;
  percentageOverride: number | null;
  fixedOverride: number | null;
  effectivePercentageValue: number;
  effectiveFixedValue: number;
};

export type AdditiveFeeInput = {
  name?: string;
  applicationScope?: string;
  displayMode?: string;
  percentageValue?: number;
  fixedValue?: number;
  active?: boolean;
};

export type AdditiveAssociationInput = {
  feeId: string;
  associated?: boolean;
  percentageOverride?: number | null;
  fixedOverride?: number | null;
  reset?: boolean;
};

const MAX_PERCENTAGE_BPS = 10_000;
const MAX_FIXED_CENTS = 2_147_483_647;

export const toAdditiveFee = (row: AdditiveFeeRow): AdditiveFee => ({
  id: row.id,
  name: row.name,
  applicationScope: row.applicationScope as FeeScope,
  displayMode: row.displayMode as FeeDisplayMode,
  percentageValue: row.percentageBps,
  fixedValue: row.fixedCents,
  active: row.active,
});

const nameKey = (name: string) => name.trim().toLowerCase();

function assertInt(value: unknown, max: number, label: string) {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > max
  )
    throw new BadRequestException(`${label} inválido`);
}

function validateFields(input: AdditiveFeeInput) {
  if (
    input.name !== undefined &&
    (typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 120)
  )
    throw new BadRequestException('Nome da taxa inválido');
  if (
    input.applicationScope !== undefined &&
    !(FEE_SCOPES as readonly string[]).includes(input.applicationScope)
  )
    throw new BadRequestException('Escopo da taxa inválido');
  if (
    input.displayMode !== undefined &&
    !(FEE_DISPLAY_MODES as readonly string[]).includes(input.displayMode)
  )
    throw new BadRequestException('Exibição da taxa inválida');
  if (input.percentageValue !== undefined)
    assertInt(input.percentageValue, MAX_PERCENTAGE_BPS, 'Percentual');
  if (input.fixedValue !== undefined)
    assertInt(input.fixedValue, MAX_FIXED_CENTS, 'Valor fixo');
}

/** Global catalog, including inactive fees, excluding soft-deleted ones. */
export async function listAdditiveFees(tx: Client): Promise<AdditiveFee[]> {
  const rows = await tx.additiveFee.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toAdditiveFee);
}

export async function createAdditiveFee(
  tx: Client,
  input: AdditiveFeeInput,
): Promise<AdditiveFee> {
  validateFields(input);
  if (!input.name || !input.applicationScope || !input.displayMode)
    throw new BadRequestException('Nome, escopo e exibição são obrigatórios');
  const key = nameKey(input.name);
  if (await tx.additiveFee.findUnique({ where: { nameKey: key } }))
    throw new ConflictException('Já existe uma taxa com esse nome');
  return toAdditiveFee(
    await tx.additiveFee.create({
      data: {
        name: input.name.trim(),
        nameKey: key,
        applicationScope: input.applicationScope,
        displayMode: input.displayMode,
        percentageBps: input.percentageValue ?? 0,
        fixedCents: input.fixedValue ?? 0,
        active: input.active ?? true,
      },
    }),
  );
}

export async function updateAdditiveFee(
  tx: Client,
  id: string,
  input: AdditiveFeeInput,
): Promise<AdditiveFee> {
  validateFields(input);
  const current = await tx.additiveFee.findFirst({
    where: { id, deletedAt: null },
  });
  if (!current) throw new NotFoundException('Taxa não encontrada');
  const data: Prisma.AdditiveFeeUpdateInput = {};
  if (input.name !== undefined) {
    const key = nameKey(input.name);
    const clash = await tx.additiveFee.findUnique({ where: { nameKey: key } });
    if (clash && clash.id !== id)
      throw new ConflictException('Já existe uma taxa com esse nome');
    data.name = input.name.trim();
    data.nameKey = key;
  }
  if (input.applicationScope !== undefined)
    data.applicationScope = input.applicationScope;
  if (input.displayMode !== undefined) data.displayMode = input.displayMode;
  if (input.percentageValue !== undefined)
    data.percentageBps = input.percentageValue;
  if (input.fixedValue !== undefined) data.fixedCents = input.fixedValue;
  if (input.active !== undefined) data.active = input.active;
  return toAdditiveFee(await tx.additiveFee.update({ where: { id }, data }));
}

/** Soft delete: frees the name and drops platform associations. */
export async function deleteAdditiveFee(tx: Client, id: string): Promise<void> {
  const current = await tx.additiveFee.findFirst({
    where: { id, deletedAt: null },
  });
  if (!current) throw new NotFoundException('Taxa não encontrada');
  await tx.platformAdditiveFee.deleteMany({ where: { feeId: id } });
  await tx.additiveFee.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      active: false,
      nameKey: `${current.nameKey}#deleted:${id}`,
    },
  });
}

export function withAssociation(
  fee: AdditiveFee,
  link?: { percentageOverride: number | null; fixedOverride: number | null },
): CompanyAdditiveFee {
  return {
    ...fee,
    associated: !!link,
    percentageOverride: link?.percentageOverride ?? null,
    fixedOverride: link?.fixedOverride ?? null,
    effectivePercentageValue: link?.percentageOverride ?? fee.percentageValue,
    effectiveFixedValue: link?.fixedOverride ?? fee.fixedValue,
  };
}

/** Whole catalog with one platform's association/overrides. GLOBAL (null) is the catalog itself, all associated. */
export async function listCompanyAdditiveFees(
  tx: Client,
  platformId: string | null,
): Promise<CompanyAdditiveFee[]> {
  const catalog = await listAdditiveFees(tx);
  if (platformId === null)
    return catalog.map((fee) =>
      withAssociation(fee, { percentageOverride: null, fixedOverride: null }),
    );
  const links = await tx.platformAdditiveFee.findMany({
    where: { platformId },
  });
  const byFee = new Map(links.map((link) => [link.feeId, link]));
  return catalog.map((fee) => withAssociation(fee, byFee.get(fee.id)));
}

/** Active, associated fees after platform overrides, regardless of the platform's fee mode. */
export async function listPlatformSurcharges(
  tx: Client,
  platformId: string,
): Promise<EffectiveFee[]> {
  const links = await tx.platformAdditiveFee.findMany({
    where: { platformId, fee: { active: true, deletedAt: null } },
    include: { fee: true },
    orderBy: { fee: { createdAt: 'asc' } },
  });
  return links.map((link) => ({
    id: link.fee.id,
    name: link.fee.name,
    applicationScope: link.fee.applicationScope as FeeScope,
    displayMode: link.fee.displayMode as FeeDisplayMode,
    percentageValue: link.percentageOverride ?? link.fee.percentageBps,
    fixedValue: link.fixedOverride ?? link.fee.fixedCents,
  }));
}

/**
 * Applies association edits. `associated:false` removes the link; `reset` clears overrides keeping the link; otherwise
 * given overrides are stored (null clears one) and any override implies association.
 */
export async function saveAdditiveAssociations(
  tx: Client,
  platformId: string,
  inputs: AdditiveAssociationInput[],
): Promise<void> {
  const ids = [...new Set(inputs.map((input) => input.feeId))];
  if (ids.length !== inputs.length)
    throw new BadRequestException('Taxa repetida');
  const fees = await tx.additiveFee.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  if (fees.length !== ids.length)
    throw new NotFoundException('Taxa não encontrada');
  for (const input of inputs) {
    if (input.percentageOverride != null)
      assertInt(input.percentageOverride, MAX_PERCENTAGE_BPS, 'Percentual');
    if (input.fixedOverride != null)
      assertInt(input.fixedOverride, MAX_FIXED_CENTS, 'Valor fixo');
    const where = { platformId_feeId: { platformId, feeId: input.feeId } };
    if (input.associated === false) {
      await tx.platformAdditiveFee.deleteMany({
        where: { platformId, feeId: input.feeId },
      });
      continue;
    }
    if (input.reset) {
      // Clears overrides; association is kept (or created when `associated:true` is sent along).
      const linked = await tx.platformAdditiveFee.findUnique({ where });
      if (linked || input.associated === true)
        await tx.platformAdditiveFee.upsert({
          where,
          create: { platformId, feeId: input.feeId },
          update: { percentageOverride: null, fixedOverride: null },
        });
      continue;
    }
    const overrides = {
      ...(input.percentageOverride !== undefined
        ? { percentageOverride: input.percentageOverride }
        : {}),
      ...(input.fixedOverride !== undefined
        ? { fixedOverride: input.fixedOverride }
        : {}),
    };
    if (input.associated === undefined && !Object.keys(overrides).length)
      continue;
    await tx.platformAdditiveFee.upsert({
      where,
      create: { platformId, feeId: input.feeId, ...overrides },
      update: overrides,
    });
  }
}
