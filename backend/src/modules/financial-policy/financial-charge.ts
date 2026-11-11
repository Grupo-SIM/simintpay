import {
  calculatePlatformFees,
  totalsToFees,
  type FeeMode,
  type AdditiveTotals,
} from '../additive-fees/additive-fee-calculation';
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
import { calculateTargetFinancials, resolveTargetFee } from './target-fee';
import {
  buildUserTaxaTag,
  isDomCashbackActive,
} from '../platform-taxas/platform-taxas.store';
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
  /** Dono da cobrança: sem plataforma, as taxas e o cashback do usuário substituem as do GLOBAL. */
  ownerUserId?: string,
) {
  if (tag === 'SIMINTPAY' || /^CLIENT:/.test(tag)) tag = 'GLOBAL';
  if (tag === 'GLOBAL' && ownerUserId) tag = buildUserTaxaTag(ownerUserId);
  const [policy, platform] = await Promise.all([
    loadFinancialPolicy(prisma, tag, at),
    loadPlatformChargeContext(prisma, tag),
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
                await listAcquirerFees(prisma, method, channel, index + 1, tag);
            },
          ),
        ),
    ),
  );
  return {
    policy,
    tag,
    acquirer,
    feesByLane,
    cashbackActive: isDomCashbackActive(tag),
    ...platform,
  };
}
/** Reserved policy tags are not registered payment platforms. */
export async function loadPlatformChargeContext(
  prisma: Pick<Prisma.TransactionClient, 'platform'>,
  tag: string,
) {
  if (
    tag === 'GLOBAL' ||
    tag === 'SIMINTPAY' ||
    tag.startsWith('CLIENT:') ||
    tag.startsWith('USER:')
  )
    return null;
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: {
      acquirer: true,
      feeMode: true,
      additiveFees: true,
      targetFeePpm: true,
    },
  });
  return platform
    ? {
        acquirer: platform.acquirer,
        platformFeeMode: platform.feeMode,
        targetFeePpm: platform.targetFeePpm,
        additiveTotals: {
          order: {
            percentageValue: platform.additiveFees?.orderPct ?? 0,
            fixedValue: platform.additiveFees?.orderFixed ?? 0,
          },
          product: {
            percentageValue: platform.additiveFees?.productPct ?? 0,
            fixedValue: platform.additiveFees?.productFixed ?? 0,
          },
        },
      }
    : null;
}
export function quoteFinancialCharge(
  context: {
    policy: ResolvedPolicy;
    acquirer: string;
    tag?: string;
    feesByLane?: Record<string, AcquirerCost[]>;
    platformFeeMode?: FeeMode;
    additiveTotals?: AdditiveTotals;
    /** Platform override (null inherits the global target, 0 turns it off); absent for non-platform charges. */
    targetFeePpm?: number | null;
  },
  amount: number,
  method: Method,
  installments = 1,
  channel: Channel = 'ONLINE',
  /** Platform fee modes treat the amount as the buyer total; offers set the buyer total themselves. */
  buyerTotalAsInput = !!context.platformFeeMode,
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
  // The global target (policy document) is the default; platform charges only, never frozen-snapshot requotes.
  const targetFeePpm =
    context.targetFeePpm === undefined
      ? null
      : resolveTargetFee(
          context.policy.document.targetFeePpm,
          context.targetFeePpm,
        );
  const key = scheduled
    ? (pricingLaneKey(
        context.policy,
        scheduled.fees,
        method,
        channel,
        installments,
      ) ?? (targetFeePpm !== null ? routeKey : undefined))
    : routeKey;
  if (targetFeePpm === null && (!key || !context.policy.document.lanes[key])) {
    if (context.platformFeeMode)
      throw new BadRequestException(
        'Taxas da plataforma não configuradas para esta modalidade',
      );
    return null;
  }
  if (!key) return null;
  if (targetFeePpm !== null && !scheduled)
    throw new BadRequestException('Custo da adquirente não configurado');
  if ((context.platformFeeMode || targetFeePpm !== null) && !fees.length)
    throw new BadRequestException('Custo da adquirente não configurado');
  let policy = context.policy;
  let additiveCents = 0;
  // Additive fees are independent of the target fee: they follow the platform fee mode either way.
  if (
    context.platformFeeMode &&
    context.platformFeeMode !== 'SIMINTPAY_ONLY' &&
    context.additiveTotals
  ) {
    const totals = context.additiveTotals;
    if (totals.product.fixedValue || totals.product.percentageValue)
      throw new BadRequestException(
        'Taxas por produto exigem uma base explícita de itens',
      );
    additiveCents = calculatePlatformFees(
      totalsToFees(totals).filter((fee) => fee.applicationScope === 'order'),
      [{ key: 'order', quantity: 1, unitPrice: cents(amount) }],
    ).feeTotalCents;
  }
  // ADDITIVE_ONLY drops the manual SimIntPay fee; the target fee replaces that fee itself.
  if (targetFeePpm === null && context.platformFeeMode === 'ADDITIVE_ONLY') {
    policy = {
      ...policy,
      document: {
        ...policy.document,
        lanes: {
          ...policy.document.lanes,
          [key]: {
            ...policy.document.lanes[key]!,
            sim: { ratePpm: 0, fixedCents: 0, interestPpm: 0 },
          },
        },
      },
    };
  }
  const r =
    targetFeePpm !== null
      ? calculateTargetFinancials(
          policy,
          key,
          cents(amount),
          targetFeePpm,
          scheduled!,
          // Buyer interest is charged normally on top of the amount; only the seller's fees change.
          false,
        )
      : calculateFinancials(
          policy,
          key,
          cents(amount),
          undefined,
          scheduled,
          buyerTotalAsInput,
        );
  if (additiveCents) {
    r.contractedCostCents += additiveCents;
    r.processingCostCents += additiveCents;
    r.netCents -= additiveCents;
    r.simMarginCents += additiveCents;
    r.differenceCents -= additiveCents;
  }
  if (context.platformFeeMode && r.netCents < 0)
    throw new BadRequestException(
      'Valor insuficiente para as taxas da plataforma',
    );
  const routed = fees.find((fee) => fee.acquirer === context.acquirer);
  return {
    financialSnapshot: {
      ...ownerResult(r),
      ...(context.platformFeeMode
        ? {
            platformFeeMode: context.platformFeeMode,
            additiveFeeCents: additiveCents,
            ...(targetFeePpm !== null ? { targetFeePpm } : {}),
            processingCostCents: r.processingCostCents,
            interestCostCents: r.interestCostCents,
          }
        : {}),
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
    platformFeeAmount:
      (r.simAdditionCents + r.simInterestCents + additiveCents) / 100,
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
  if (context.platformFeeMode)
    return quoteFinancialCharge(context, buyerTotal, method, n, 'POS');
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
    platformFeeMode?: FeeMode;
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
