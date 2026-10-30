import { BadRequestException } from '@nestjs/common';
import {
  calculateFinancials,
  defaultOwner,
  cents,
  emptyPolicy,
  resolvePolicy,
  laneKey,
  ownerResult,
  pricingLaneKey,
  validateKey,
  type Policy,
  type Channel,
  type Method,
  type ResolvedPolicy,
  type ScheduledFee,
} from './financial-policy';
import { listAcquirerFees, type AcquirerCost } from './acquirer-fees';
import { loadFinancialPolicy } from './financial-policy.service';
import type { Prisma } from '@prisma/client';

export async function loadChargePolicy(
  prisma: Pick<
    Prisma.TransactionClient,
    | 'financialPolicyRevision'
    | 'platform'
    | 'acquirerCatalogue'
    | 'acquirerFeeSchedule'
  >,
  tag: string,
  at?: Date,
) {
  const [policy, platform] = await Promise.all([
    loadFinancialPolicy(prisma, tag, at),
    prisma.platform.findUnique({ where: { tag }, select: { acquirer: true } }),
  ]);
  const acquirer = platform?.acquirer ?? 'DOM';
  const feesByLane: Record<string, AcquirerCost[]> = {};
  await Promise.all(
    (['PIX', 'DEBIT_CARD', 'BOLETO', 'CREDIT_CARD'] as Method[]).flatMap(
      (method) =>
        (['ONLINE', 'POS'] as Channel[]).flatMap((channel) =>
          Array.from(
            { length: method === 'CREDIT_CARD' ? 12 : 1 },
            async (_, index) => {
              feesByLane[`${method}/${channel}/${index + 1}`] =
                await listAcquirerFees(prisma, method, channel, index + 1);
            },
          ),
        ),
    ),
  );
  return { policy, tag, acquirer, feesByLane };
}
export function quoteFinancialCharge(
  context: {
    policy: ResolvedPolicy;
    acquirer: string;
    tag?: string;
    feesByLane?: Record<string, AcquirerCost[]>;
  },
  amount: number,
  method: Method,
  installments = 1,
  channel: Channel = 'ONLINE',
) {
  const routeKey = laneKey(context.acquirer, method, channel, installments);
  try {
    validateKey(routeKey);
  } catch {
    throw new BadRequestException('Modalidade, canal ou parcela inválidos');
  }
  const fees =
    context.feesByLane?.[`${method}/${channel}/${installments}`] ?? [];
  const scheduled = context.feesByLane
    ? {
        fees: fees.map(
          ({ createdAt, ...fee }): ScheduledFee => ({
            ...fee,
            createdAt: createdAt.toISOString(),
          }),
        ),
        routedAcquirer: context.acquirer,
      }
    : undefined;
  const key = scheduled
    ? pricingLaneKey(
        context.policy,
        scheduled.fees,
        method,
        channel,
        installments,
      )
    : routeKey;
  if (!key || !context.policy.document.lanes[key]) return null; // Unconfigured lanes retain legacy pricing.
  const r = calculateFinancials(
    context.policy,
    key,
    cents(amount),
    undefined,
    scheduled,
  );
  const routed = fees.find((fee) => fee.acquirer === context.acquirer);
  return {
    financialSnapshot: {
      ...ownerResult(r),
      ...(routed
        ? {
            acquirerCost: {
              ...routed,
              createdAt: routed.createdAt.toISOString(),
              realizedCents: r.acquirerCostCents,
            },
          }
        : scheduled
          ? {
              acquirerCost: {
                acquirer: context.acquirer,
                source: 'UNCONFIGURED',
                realizedCents: null,
              },
            }
          : {}),
      ...(context.policy.document.interestOnly ? { interestOnly: true } : {}),
      ...(context.policy.document.owner[key]?.passInterestPpm === 1_000_000 &&
      !context.policy.global.owner[key] &&
      !context.policy.own.owner[key]
        ? { defaultInterestPassThrough: true }
        : {}),
      policyTag: context.tag ?? 'GLOBAL',
    },
    baseAmount: r.originalCents / 100,
    totalAmount: r.buyerTotalCents / 100,
    netAmount: r.netCents / 100,
    domFeeAmount: r.acquirerCostCents / 100,
    sellerFee: (r.simAdditionCents + r.simInterestCents) / 100,
    platformFeeRate: (r.buyerInterestCents / r.originalCents) * 100,
    interestAmount: r.buyerInterestCents / 100,
    installmentAmount: r.installmentCents / 100,
    domFeeRate: 0,
    platformFeePercent: 0,
    platformFeeFixed: 0,
    domFeePercent: 0,
    domFeeFixed: 0,
    totalFeeAmount: r.contractedCostCents / 100,
    platformFeeAmount: (r.simAdditionCents + r.simInterestCents) / 100,
    platformFeeTotal: r.contractedCostCents / 100,
    platformProfit: r.simMarginCents / 100,
  };
}

/** Terminal reports buyer total. Invert the same monotonic cent function; never charge its costs twice. */
export function quoteReportedPos(
  context: Awaited<ReturnType<typeof loadChargePolicy>>,
  buyerTotal: number,
  method: Method,
  n = 1,
) {
  const routeKey = laneKey(context.acquirer, method, 'POS', n);
  const fees = context.feesByLane?.[`${method}/POS/${n}`] ?? [];
  const key = context.feesByLane
    ? pricingLaneKey(
        context.policy,
        fees.map(({ createdAt, ...fee }) => ({
          ...fee,
          createdAt: createdAt.toISOString(),
        })),
        method,
        'POS',
        n,
      )
    : routeKey;
  if (!key || !context.policy.document.lanes[key]) return null;
  const target = cents(buyerTotal);
  let low = 1,
    high = Math.min(target, 1_000_000_000);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const fees = context.feesByLane?.[`${method}/POS/${n}`] ?? [];
    const result = calculateFinancials(
      context.policy,
      key,
      middle,
      undefined,
      context.feesByLane
        ? {
            fees: fees.map(({ createdAt, ...fee }) => ({
              ...fee,
              createdAt: createdAt.toISOString(),
            })),
            routedAcquirer: context.acquirer,
          }
        : undefined,
    );
    if (result.buyerTotalCents === target)
      return quoteFinancialCharge(context, middle / 100, method, n, 'POS');
    if (result.buyerTotalCents < target) low = middle + 1;
    else high = middle - 1;
  }
  throw new Error('Total POS não corresponde à política financeira');
}

/** Recurring contracts retain their original immutable revisions, even after later policy changes. */
export async function restoreFinancialCharge(
  prisma: Pick<Prisma.TransactionClient, 'financialPolicyRevision'>,
  snapshot: Prisma.JsonValue | null | undefined,
) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const saved = snapshot as unknown as {
    version: string;
    policyTag: string;
    key: string;
    interestOnly?: boolean;
    defaultInterestPassThrough?: boolean;
    acquirerCost?: AcquirerCost & { realizedCents: number | null };
    originalCents: number;
    buyerTotalCents: number;
    netCents: number;
    contractedCostCents?: number;
  };
  if (typeof saved.version !== 'string' || typeof saved.policyTag !== 'string')
    throw new Error('Snapshot financeiro inválido');
  const [globalVersion, ownVersion] = saved.version.split(':').map(Number);
  const rows = await prisma.financialPolicyRevision.findMany({
    where: {
      OR: [
        { tag: 'GLOBAL', version: globalVersion },
        { tag: saved.policyTag, version: ownVersion },
      ],
    },
  });
  const global = rows.find(
      (row) => row.tag === 'GLOBAL' && row.version === globalVersion,
    ),
    own = rows.find(
      (row) => row.tag === saved.policyTag && row.version === ownVersion,
    );
  const policy =
    saved.policyTag === 'GLOBAL'
      ? resolvePolicy(
          emptyPolicy(),
          (global?.document as Policy | undefined) ?? emptyPolicy(),
          saved.version,
        )
      : resolvePolicy(
          (global?.document as Policy | undefined) ?? emptyPolicy(),
          (own?.document as Policy | undefined) ?? emptyPolicy(),
          saved.version,
        );
  if (saved.interestOnly === true) policy.document.interestOnly = true;
  if (saved.defaultInterestPassThrough === true)
    policy.document.owner[saved.key] ??= {
      ...defaultOwner(),
      passInterestPpm: 1_000_000,
    };
  const [acquirer, method, channel, n] = saved.key.split('/');
  // V2 snapshots are immutable monetary facts: do not resolve today's acquirer schedules on renewal.
  if (saved.acquirerCost) {
    const realizedCents = saved.acquirerCost.realizedCents;
    const unknownCost =
      saved.acquirerCost.source === 'UNCONFIGURED' && realizedCents === null;
    if (
      ![
        saved.originalCents,
        saved.buyerTotalCents,
        saved.netCents,
        saved.contractedCostCents,
      ].every(Number.isSafeInteger) ||
      (!unknownCost && !Number.isSafeInteger(realizedCents)) ||
      saved.buyerTotalCents - saved.netCents !== saved.contractedCostCents
    )
      throw new Error('Snapshot financeiro inválido');
    const knownCost = unknownCost
      ? {}
      : {
          domFeeAmount: realizedCents! / 100,
          sellerFee: ((saved.contractedCostCents ?? 0) - realizedCents!) / 100,
          platformFeeAmount:
            ((saved.contractedCostCents ?? 0) - realizedCents!) / 100,
          platformProfit:
            ((saved.contractedCostCents ?? 0) - realizedCents!) / 100,
        };
    return {
      financialSnapshot: { ...saved, policyTag: saved.policyTag },
      baseAmount: saved.originalCents / 100,
      totalAmount: saved.buyerTotalCents / 100,
      netAmount: saved.netCents / 100,
      ...knownCost,
      platformFeeRate: 0,
      interestAmount: 0,
      installmentAmount: saved.buyerTotalCents / (100 * Number(n)),
      domFeeRate: 0,
      platformFeePercent: 0,
      platformFeeFixed: 0,
      domFeePercent: 0,
      domFeeFixed: 0,
      totalFeeAmount: (saved.contractedCostCents ?? 0) / 100,
      platformFeeTotal: (saved.contractedCostCents ?? 0) / 100,
    };
  }
  const quote = quoteFinancialCharge(
    { policy, tag: saved.policyTag, acquirer },
    saved.originalCents / 100,
    method as Method,
    Number(n),
    channel as Channel,
  );
  if (
    !quote ||
    cents(quote.totalAmount) !== saved.buyerTotalCents ||
    cents(quote.netAmount) !== saved.netCents
  )
    throw new Error('Snapshot financeiro incompatível');
  return quote;
}
