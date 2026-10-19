import { BadRequestException } from '@nestjs/common';
import { calculateFinancials, cents, emptyPolicy, resolvePolicy, laneKey, ownerResult, validateKey, type Policy, type Channel, type Method, type ResolvedPolicy } from './financial-policy';
import { loadFinancialPolicy } from './financial-policy.service';
import type { Prisma } from '@prisma/client';

export async function loadChargePolicy(prisma: Pick<Prisma.TransactionClient, 'financialPolicyRevision' | 'platform'>, tag: string, at?: Date) {
  const [policy, platform] = await Promise.all([loadFinancialPolicy(prisma, tag, at), prisma.platform.findUnique({ where: { tag }, select: { acquirer: true } })]);
  return { policy, tag, acquirer: platform?.acquirer ?? 'DOM' };
}
export function quoteFinancialCharge(context: { policy: ResolvedPolicy; acquirer: string; tag?: string }, amount: number, method: Method, installments = 1, channel: Channel = 'ONLINE') {
  const key = laneKey(context.acquirer, method, channel, installments);
  try { validateKey(key); } catch { throw new BadRequestException('Modalidade, canal ou parcela inválidos'); }
  if (!context.policy.document.lanes[key]) return null; // Unconfigured lanes retain legacy pricing; configured admin rates apply immediately.
  const r = calculateFinancials(context.policy, key, cents(amount));
  return { financialSnapshot: { ...ownerResult(r), ...(context.policy.document.interestOnly ? { interestOnly: true } : {}), policyTag: context.tag ?? 'GLOBAL' }, baseAmount: r.originalCents / 100, totalAmount: r.buyerTotalCents / 100,
    netAmount: r.netCents / 100, domFeeAmount: r.acquirerCostCents / 100,
    sellerFee: (r.simAdditionCents + r.simInterestCents) / 100,
    platformFeeRate: r.buyerInterestCents / r.originalCents * 100, interestAmount: r.buyerInterestCents / 100,
    installmentAmount: r.installmentCents / 100, domFeeRate: 0,
    platformFeePercent: 0, platformFeeFixed: 0, domFeePercent: 0, domFeeFixed: 0,
    totalFeeAmount: r.contractedCostCents / 100, platformFeeAmount: (r.simAdditionCents + r.simInterestCents) / 100,
    platformFeeTotal: r.contractedCostCents / 100, platformProfit: r.simMarginCents / 100 };
}

/** Terminal reports buyer total. Invert the same monotonic cent function; never charge its costs twice. */
export function quoteReportedPos(context: Awaited<ReturnType<typeof loadChargePolicy>>, buyerTotal: number, method: Method, n = 1) {
  const key = laneKey(context.acquirer, method, 'POS', n);
  if (!context.policy.document.lanes[key]) return null;
  const target = cents(buyerTotal);
  let low = 1, high = Math.min(target, 1_000_000_000);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const result = calculateFinancials(context.policy, key, middle);
    if (result.buyerTotalCents === target) return quoteFinancialCharge(context, middle / 100, method, n, 'POS');
    if (result.buyerTotalCents < target) low = middle + 1; else high = middle - 1;
  }
  throw new Error('Total POS não corresponde à política financeira');
}

/** Recurring contracts retain their original immutable revisions, even after later policy changes. */
export async function restoreFinancialCharge(prisma: Pick<Prisma.TransactionClient, 'financialPolicyRevision'>, snapshot: Prisma.JsonValue | null | undefined) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const saved = snapshot as { version: string; policyTag: string; key: string; interestOnly?: boolean; originalCents: number; buyerTotalCents: number; netCents: number };
  if (typeof saved.version !== 'string' || typeof saved.policyTag !== 'string') throw new Error('Snapshot financeiro inválido');
  const [globalVersion, ownVersion] = saved.version.split(':').map(Number);
  const rows = await prisma.financialPolicyRevision.findMany({ where: { OR: [{ tag: 'GLOBAL', version: globalVersion }, { tag: saved.policyTag, version: ownVersion }] } });
  const global = rows.find(row => row.tag === 'GLOBAL' && row.version === globalVersion), own = rows.find(row => row.tag === saved.policyTag && row.version === ownVersion);
  const policy = saved.policyTag === 'GLOBAL'
    ? resolvePolicy(emptyPolicy(), (global?.document as Policy | undefined) ?? emptyPolicy(), saved.version)
    : resolvePolicy((global?.document as Policy | undefined) ?? emptyPolicy(), (own?.document as Policy | undefined) ?? emptyPolicy(), saved.version);
  if (saved.interestOnly === true) policy.document.interestOnly = true;
  const [acquirer, method, channel, n] = saved.key.split('/');
  const quote = quoteFinancialCharge({ policy, tag: saved.policyTag, acquirer }, saved.originalCents / 100, method as Method, Number(n), channel as Channel);
  if (!quote || cents(quote.totalAmount) !== saved.buyerTotalCents || cents(quote.netAmount) !== saved.netCents) throw new Error('Snapshot financeiro incompatível');
  return quote;
}
