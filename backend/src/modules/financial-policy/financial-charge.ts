import {
  calculatePlatformFees,
  totalsToFees,
  type FeeMode,
  type AdditiveTotals,
  type FeeItemInput,
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
import {
  estimatedCost,
  listAcquirerFees,
  type AcquirerCost,
} from './acquirer-fees';
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
  /** Explicit priced lines (cents) for product-scope additive fees; without them, one order line over the amount. */
  items?: FeeItemInput[],
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
        fees: fees.map(({ createdAt, ...fee }): ScheduledFee => ({
          ...fee,
          createdAt: createdAt.toISOString(),
        })),
        routedAcquirer: context.acquirer,
      }
    : undefined;
  const additiveOnly = context.platformFeeMode === 'ADDITIVE_ONLY';
  // The global target (policy document) is the default; platform charges only, never frozen-snapshot requotes.
  // ADDITIVE_ONLY charges the seller nothing, so the target fee never applies there.
  let targetFeePpm =
    context.targetFeePpm === undefined || additiveOnly
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
      ) ?? (targetFeePpm !== null || additiveOnly ? routeKey : undefined))
    : routeKey;
  // A lane may opt out of the target so its manual SimIntPay additional is honored.
  if (key && context.policy.document.lanes[key]?.targetFeeOff)
    targetFeePpm = null;
  if (
    targetFeePpm === null &&
    !(additiveOnly && key && fees.length) &&
    (!key || !context.policy.document.lanes[key])
  ) {
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
  let policy = context.platformFeeMode
    ? // Platform modes never charge the buyer the processing fees: only passed interest (and additives).
      {
        ...context.policy,
        document: { ...context.policy.document, interestOnly: true },
      }
    : context.policy;
  const additiveCents = quoteAdditiveFees(
    context.platformFeeMode,
    context.additiveTotals,
    cents(amount),
    items,
  );
  // ADDITIVE_ONLY drops the SimIntPay fee (the lane may not even exist): the seller pays nothing.
  if (additiveOnly) {
    const stored = policy.document.lanes[key];
    policy = {
      ...policy,
      document: {
        ...policy.document,
        lanes: {
          ...policy.document.lanes,
          [key]: {
            ...stored,
            active: true,
            contract: stored?.contract ?? {
              fixedCents: 0,
              ratePpm: 0,
              cashbackCents: 0,
              interestPpm: 0,
              base: 'ORIGINAL',
              reference: '',
            },
            sim: { ratePpm: 0, fixedCents: 0, interestPpm: 0 },
          },
        },
        owner: {
          ...policy.document.owner,
          [key]: policy.document.owner[key] ?? {
            ...defaultOwner(),
            passInterestPpm: key.includes('/CREDIT_CARD/') ? 1_000_000 : 0,
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
      : calculateFinancials(policy, key, cents(amount), undefined, scheduled);
  const routed = fees.find((fee) => fee.acquirer === context.acquirer);
  const acquirerCostBorneBySimCents = context.platformFeeMode
    ? applyFeeMode(r, context.platformFeeMode, additiveCents, routed)
    : 0;
  if (context.platformFeeMode && r.netCents < 0)
    throw new BadRequestException(
      'Valor insuficiente para as taxas da plataforma',
    );
  return {
    financialSnapshot: {
      ...ownerResult(r),
      ...(context.platformFeeMode
        ? {
            platformFeeMode: context.platformFeeMode,
            additiveFeeCents: additiveCents,
            sellerFeeCents: r.originalCents - r.netCents,
            acquirerCostBorneBySimCents,
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
      ...(policy.document.interestOnly ? { interestOnly: true } : {}),
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
    sellerFee: context.platformFeeMode
      ? (r.originalCents - r.netCents) / 100
      : (r.simAdditionCents + r.simInterestCents) / 100,
    additiveFeeAmount: additiveCents / 100,
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

/**
 * Platform additive fees: SimIntPay revenue added to the buyer total, never deducted from the seller. Product-scope
 * fees need explicit item lines; without them the amount is a single order line.
 */
export function quoteAdditiveFees(
  mode: FeeMode | undefined,
  totals: AdditiveTotals | undefined,
  amountCents: number,
  items?: FeeItemInput[],
) {
  if (!mode || mode === 'SIMINTPAY_ONLY' || !totals) return 0;
  const product = totals.product.fixedValue || totals.product.percentageValue;
  if (product && !items?.length)
    throw new BadRequestException(
      'Taxas por produto exigem uma base explícita de itens',
    );
  return calculatePlatformFees(
    totalsToFees(totals).filter(
      (fee) => fee.applicationScope === 'order' || items?.length,
    ),
    items?.length
      ? items
      : [{ key: 'order', quantity: 1, unitPrice: amountCents }],
  ).feeTotalCents;
}

type QuoteResult = ReturnType<typeof calculateFinancials>;

/**
 * Applies the platform fee mode to a seller-side quote (buyer pays base + passed interest):
 * - additive fees are added to the buyer total and to SimIntPay's margin, never to the seller's fees;
 * - ADDITIVE_ONLY: the seller keeps the whole base; SimIntPay bears the acquirer cost and the non-passed
 *   interest out of the additive fees (margin = additives - borne cost, possibly negative).
 * The acquirer cost is re-estimated on the final buyer total; the extra caused by additives is SimIntPay's.
 * Keeps `buyerTotalCents - netCents === contractedCostCents`. Returns the acquirer cost and non-passed interest
 * borne by SimIntPay in ADDITIVE_ONLY (0 in the seller-paying modes).
 */
export function applyFeeMode(
  r: QuoteResult,
  mode: FeeMode,
  additiveCents: number,
  routed?: AcquirerCost,
) {
  let extra = 0;
  if (additiveCents) {
    r.buyerTotalCents += additiveCents;
    r.buyerAdditionCents += additiveCents;
    r.contractedCostCents += additiveCents;
    r.processingCostCents += additiveCents;
    r.simMarginCents += additiveCents;
    r.installmentCents = Math.floor(r.buyerTotalCents / r.installments);
    r.lastInstallmentCents =
      r.buyerTotalCents - r.installmentCents * (r.installments - 1);
    if (routed) {
      const cost = estimatedCost(routed, r.originalCents, r.buyerTotalCents);
      extra = cost - r.acquirerCostCents;
      r.acquirerCostCents += extra;
      r.acquirerProcessingCents += extra;
      r.simMarginCents -= extra;
    }
  }
  // Seller-paying modes keep the seller's fees; the additive-caused acquirer extra is SimIntPay's margin cost.
  if (mode !== 'ADDITIVE_ONLY') return 0;
  const borne = r.originalCents - r.netCents;
  r.netCents += borne;
  r.contractedCostCents -= borne;
  r.processingCostCents = r.contractedCostCents - r.interestCostCents;
  r.simMarginCents -= borne;
  r.differenceCents += borne;
  return borne + extra;
}

/** Terminal reports buyer total. Invert the same monotonic cent function; never charge its costs twice. */
export function quoteReportedPos(
  context: Awaited<ReturnType<typeof loadChargePolicy>>,
  buyerTotal: number,
  method: Method,
  n = 1,
) {
  // Platform modes add passed interest and additive fees on top of the base: invert the buyer total.
  if (context.platformFeeMode) {
    const target = cents(buyerTotal);
    let low = 1,
      high = Math.min(target, 1_000_000_000);
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const quote = quoteFinancialCharge(
        context,
        middle / 100,
        method,
        n,
        'POS',
      );
      if (!quote) return null;
      const total = cents(quote.totalAmount);
      if (total === target) return quote;
      if (total < target) low = middle + 1;
      else high = middle - 1;
    }
    throw new Error('Total POS não corresponde à política financeira');
  }
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
    /** Unified fee-mode snapshots: additives on the buyer, seller fee and SimIntPay-borne cost. */
    additiveFeeCents?: number;
    sellerFeeCents?: number;
    acquirerCostBorneBySimCents?: number;
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
          sellerFee:
            (saved.sellerFeeCents ??
              (saved.contractedCostCents ?? 0) - realizedCents!) / 100,
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
      ...(saved.additiveFeeCents !== undefined
        ? { additiveFeeAmount: saved.additiveFeeCents / 100 }
        : {}),
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
