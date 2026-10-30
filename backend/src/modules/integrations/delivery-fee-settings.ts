import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { acquirerCostFloor } from '../financial-policy/acquirer-fees';
import { loadFinancialPolicy } from '../financial-policy/financial-policy.service';
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

async function platformOf(tx: Prisma.TransactionClient, companyId: string) {
  const registration = await tx.deliveryPlatformRegistration.findUnique({
    where: { externalMerchantId: companyId },
  });
  if (!registration?.platformId)
    throw new NotFoundException('Empresa sem plataforma financeira');
  const platform = await tx.platform.findUniqueOrThrow({
    where: { id: registration.platformId },
    select: { ownerUserId: true, tag: true },
  });
  return platform;
}

/** SimIntPay fees (`sim`) effective for one Delivery company, plus the global acquirer cost floor. */
export async function readDeliveryFees(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
  const { tag } = await platformOf(tx, companyId);
  const policy = await loadFinancialPolicy(tx, tag);
  const lanes = new Map<string, DeliveryFeeLane>();
  for (const [key, lane] of Object.entries(policy.document.lanes).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const [, method, channel, n] = key.split('/');
    if (channel !== 'ONLINE') continue;
    const id = `${method}/${n}`;
    // Acquirers share one SimIntPay fee per lane; the first (alphabetical) represents it.
    if (!lanes.has(id))
      lanes.set(id, {
        method: method as Method,
        channel: 'ONLINE',
        installments: Number(n),
        fixedCents: lane.sim.fixedCents,
        ratePpm: lane.sim.ratePpm,
      });
  }
  return {
    version: policy.version,
    lanes: [...lanes.values()],
    costs: await acquirerCostFloor(tx),
  };
}

export async function saveDeliveryFees(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: { version: string; lanes: DeliveryFeeLane[] },
) {
  const { ownerUserId, tag } = await platformOf(tx, companyId);
  const current = await loadFinancialPolicy(tx, tag);
  if (input.version !== current.version)
    throw new ConflictException(
      'Configuração alterada. Recarregue antes de salvar.',
    );
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
