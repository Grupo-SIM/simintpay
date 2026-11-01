import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DeliveryFeeMode, Prisma } from '@prisma/client';
import { acquirerCostFloor } from '../financial-policy/acquirer-fees';
import { loadFinancialPolicy } from '../financial-policy/financial-policy.service';
import {
  evaluateCoverage,
  hasShortfall,
  surchargeComponents,
} from '../additive-fees/additive-fee-calculation';
import {
  listAdditiveValues,
  replaceAdditiveValues,
  toEffectiveFees,
  validateAdditiveValues,
} from '../additive-fees/additive-fees.service';
import {
  emptyPolicy,
  validatePolicy,
  type Method,
  type Policy,
} from '../financial-policy/financial-policy';

export type DeliveryFeeLane = {
  method: Method;
  channel: 'ONLINE';
  installments: number;
  fixedCents: number;
  ratePpm: number;
};

function laneMatches(
  key: string,
  lane: Pick<DeliveryFeeLane, 'method' | 'installments'>,
) {
  const [, method, channel, n] = key.split('/');
  return (
    method === lane.method &&
    channel === 'ONLINE' &&
    Number(n) === lane.installments
  );
}

const METHOD_ORDER: Record<string, number> = {
  CREDIT_CARD: 0,
  DEBIT_CARD: 1,
  PIX: 2,
  BOLETO: 3,
};

/** Lane identity used by `disabledLanes`: `METHOD/installments`. */
export const deliveryLaneId = (
  lane: Pick<DeliveryFeeLane, 'method' | 'installments'>,
) => `${lane.method}/${lane.installments}`;

/** Methods in a fixed order, then installments numerically (10x must come after 2x). */
export function compareLanes(
  a: Pick<DeliveryFeeLane, 'method' | 'installments'>,
  b: Pick<DeliveryFeeLane, 'method' | 'installments'>,
) {
  return (
    (METHOD_ORDER[a.method] ?? 99) - (METHOD_ORDER[b.method] ?? 99) ||
    a.installments - b.installments
  );
}

async function platformOf(tx: Prisma.TransactionClient, companyId: string) {
  const registration = await tx.deliveryPlatformRegistration.findUnique({
    where: { externalMerchantId: companyId },
  });
  if (!registration?.platformId)
    throw new NotFoundException('Empresa sem plataforma financeira');
  const platform = await tx.platform.findUniqueOrThrow({
    where: { id: registration.platformId },
    select: {
      deliveryDisabledLanes: true,
      deliveryFeeMode: true,
      id: true,
      ownerUserId: true,
      tag: true,
    },
  });
  return platform;
}

/** One SimIntPay fee per `METHOD/installments`; acquirers share it, so the first (alphabetical) represents it. */
function policyLanes(document: Policy): DeliveryFeeLane[] {
  const lanes = new Map<string, DeliveryFeeLane>();
  for (const [key, lane] of Object.entries(document.lanes).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const [, method, channel, n] = key.split('/');
    if (channel !== 'ONLINE') continue;
    const id = `${method}/${n}`;
    if (!lanes.has(id))
      lanes.set(id, {
        method: method as Method,
        channel: 'ONLINE',
        installments: Number(n),
        fixedCents: lane.sim.fixedCents,
        ratePpm: lane.sim.ratePpm,
      });
  }
  return [...lanes.values()].sort(compareLanes);
}

/**
 * Global SimIntPay fees (before any company override) next to the highest acquirer cost per lane. Admin-only: platform
 * owners never see acquirers, so this is not part of `readDeliveryFees`.
 */
export async function readDeliveryFeeDefaults(tx: Prisma.TransactionClient) {
  const policy = await loadFinancialPolicy(tx, 'GLOBAL');
  return {
    costs: (await acquirerCostFloor(tx)).sort(compareLanes),
    lanes: policyLanes(policy.document),
  };
}

/**
 * SimIntPay fees (`sim`) effective for one Delivery company, plus the global acquirer cost floor. Every lane is
 * listed; `disabledLanes` (`METHOD/installments`) are the ones the platform does not accept, which consumers skip.
 */
export async function readDeliveryFees(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
  const { deliveryDisabledLanes, deliveryFeeMode, id, tag } = await platformOf(
    tx,
    companyId,
  );
  const policy = await loadFinancialPolicy(tx, tag);
  const lanes = policyLanes(policy.document);
  const costs = (await acquirerCostFloor(tx)).sort(compareLanes);
  const disabledLanes = [...deliveryDisabledLanes].sort();
  const additiveFees = await listAdditiveValues(tx, id);
  const coverage = evaluateCoverage({
    costs,
    disabledLanes,
    mode: deliveryFeeMode,
    simintpay: lanes,
    surcharges: surchargeComponents(toEffectiveFees(additiveFees)),
  });
  return {
    mode: deliveryFeeMode,
    version: policy.version,
    disabledLanes,
    lanes,
    costs,
    additiveFees,
    coverage,
    underCovered: hasShortfall(coverage),
  };
}

export async function saveDeliveryFees(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: {
    version: string;
    lanes: DeliveryFeeLane[];
    mode?: DeliveryFeeMode;
    disabledLanes?: string[];
    additiveFees?: unknown;
  },
) {
  const { id: platformId, ownerUserId, tag } = await platformOf(tx, companyId);
  const current = await loadFinancialPolicy(tx, tag);
  if (input.version !== current.version)
    throw new ConflictException(
      'Configuração alterada. Recarregue antes de salvar.',
    );
  if (input.mode !== undefined)
    await tx.platform.update({
      where: { id: platformId },
      data: { deliveryFeeMode: input.mode },
    });
  if (input.disabledLanes !== undefined)
    await tx.platform.update({
      where: { id: platformId },
      data: { deliveryDisabledLanes: [...new Set(input.disabledLanes)].sort() },
    });
  // Same transaction and version check as the lanes, so mode, lanes and additive fees land together or not at all.
  if (input.additiveFees !== undefined)
    await replaceAdditiveValues(
      tx,
      platformId,
      validateAdditiveValues(input.additiveFees),
    );
  // A mode-only change must not create an empty policy revision.
  if (!input.lanes.length) return readDeliveryFees(tx, companyId);
  const previous = await tx.financialPolicyRevision.findFirst({
    where: { tag },
    orderBy: { version: 'desc' },
  });
  const document = structuredClone(
    (previous?.document as Policy | undefined) ?? emptyPolicy(),
  );
  for (const edit of input.lanes) {
    const keys = Object.keys(current.document.lanes).filter((key) =>
      laneMatches(key, edit),
    );
    if (!keys.length)
      throw new BadRequestException(
        'Modalidade ou parcela sem taxas configuradas',
      );
    for (const key of keys) {
      const lane = structuredClone(
        document.lanes[key] ?? current.document.lanes[key]!,
      );
      lane.sim = {
        ...lane.sim,
        fixedCents: edit.fixedCents,
        ratePpm: edit.ratePpm,
      };
      document.lanes[key] = lane;
    }
  }
  document.interestOnly = true;
  try {
    validatePolicy(document);
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
  await tx.financialPolicyRevision.create({
    data: {
      tag,
      version: (previous?.version ?? 0) + 1,
      actorId: ownerUserId,
      document: document as Prisma.InputJsonValue,
    },
  });
  return readDeliveryFees(tx, companyId);
}
