import { Prisma } from '@prisma/client';

export const METHODS = ['PIX', 'DEBIT_CARD', 'BOLETO', 'CREDIT_CARD'] as const;
export const CHANNELS = ['ONLINE', 'POS'] as const;
export type Method = typeof METHODS[number];
export type Channel = typeof CHANNELS[number];
/** All money is integer cents; all rates are integer millionths of original value. */
export type Addition = { fixedCents: number; ratePpm: number };
export type Contract = Addition & { cashbackCents: number; interestPpm: number; base: 'ORIGINAL' | 'BUYER_TOTAL'; reference: string };
/** active is retained for stored-document compatibility; configured rates apply without activation. */
export type Lane = { total?: Addition; active: boolean; contract: Contract; sim: Addition & { interestPpm: number } };
export type OwnerRule = Addition & { passInterestPpm: number };
export type Policy = { schemaVersion: 1; lanes: Record<string, Lane>; owner: Record<string, OwnerRule>; interestFree?: boolean; interestOnly?: boolean; legacyAudit?: unknown };
export type ResolvedPolicy = { global: Policy; own: Policy; version: string; document: Policy; sources: Record<string, { lane: 'global' | 'override'; owner: 'global' | 'override' | 'default' }> };
export const emptyPolicy = (): Policy => ({ schemaVersion: 1, lanes: {}, owner: {} });
export const defaultOwner = (): OwnerRule => ({ fixedCents: 0, ratePpm: 0, passInterestPpm: 0 });
export function laneKey(acquirer: string, method: Method, channel: Channel, installments: number) { return `${acquirer}/${method}/${channel}/${installments}`; }
export function resolvePolicy(global: Policy, own: Policy, version: string): ResolvedPolicy {
  const lanes = { ...global.lanes, ...own.lanes }, owner = { ...global.owner, ...own.owner };
  return { global, own, version, document: { schemaVersion: 1, lanes, owner, interestFree: own.interestFree ?? global.interestFree ?? false, interestOnly: own.interestOnly ?? global.interestOnly ?? false },
    sources: Object.fromEntries(Object.keys(lanes).map(key => [key, { lane: own.lanes[key] !== undefined ? 'override' : 'global', owner: own.owner[key] !== undefined ? 'override' : global.owner[key] !== undefined ? 'global' : 'default' }])) };
}
const D = Prisma.Decimal;
const round = (value: Prisma.Decimal) => value.toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber();
const fraction = (cents: number, ppm: number) => new D(cents).mul(ppm).div(1_000_000);
export function cents(value: number | string | Prisma.Decimal) { return round(new D(value).mul(100)); }

/** Pure calculation shared by previews, charge snapshots and settlement. Each cost deducted once. */
export function calculateFinancials(policy: ResolvedPolicy, key: string, originalCents: number, interestFree = policy.document.interestFree) {
  if (!Number.isSafeInteger(originalCents) || originalCents <= 0 || originalCents > 1_000_000_000) throw new Error('Valor inválido');
  const lane = policy.document.lanes[key];
  if (!lane) throw new Error('Taxas administrativas não configuradas para esta modalidade, canal e parcela');
  const owner = policy.document.owner[key] ?? defaultOwner();
  const n = Number(key.split('/')[3]);
  const acquirerInterestCents = round(fraction(originalCents, lane.contract.interestPpm));
  const simInterestCents = round(fraction(originalCents, lane.sim.interestPpm));
  const interestCostCents = acquirerInterestCents + simInterestCents;
  const buyerInterestCents = interestFree ? 0 : round(fraction(interestCostCents, owner.passInterestPpm));
  const buyerAdditionCents = policy.document.interestOnly ? 0 : owner.fixedCents + round(fraction(originalCents, owner.ratePpm));
  const buyerTotalCents = originalCents + buyerAdditionCents + buyerInterestCents;
  const acquirerBase = lane.contract.base === 'BUYER_TOTAL' ? buyerTotalCents : originalCents;
  const acquirerProcessingCents = lane.contract.fixedCents + round(fraction(acquirerBase, lane.contract.ratePpm)) + lane.contract.cashbackCents;
  // Legacy administrative totals already include processing; never deduct it twice.
  const processingTotalCents = lane.total ? lane.total.fixedCents + round(fraction(originalCents, lane.total.ratePpm)) : undefined;
  const simAdditionCents = processingTotalCents !== undefined
    ? processingTotalCents - acquirerProcessingCents
    : lane.sim.fixedCents + round(fraction(originalCents, lane.sim.ratePpm));
  const acquirerCostCents = acquirerProcessingCents + acquirerInterestCents;
  const contractedCostCents = acquirerCostCents + simAdditionCents + simInterestCents;
  const netCents = buyerTotalCents - contractedCostCents;
  return { version: policy.version, key, installments: n, originalCents, buyerAdditionCents, buyerInterestCents, buyerTotalCents,
    installmentCents: Math.floor(buyerTotalCents / n), lastInstallmentCents: buyerTotalCents - Math.floor(buyerTotalCents / n) * (n - 1),
    contractedCostCents, netCents, differenceCents: netCents - originalCents,
    acquirerCostCents, acquirerProcessingCents, acquirerInterestCents, simAdditionCents, simInterestCents,
    simMarginCents: contractedCostCents - acquirerCostCents };
}
export type FinancialResult = ReturnType<typeof calculateFinancials>;
export function ownerResult(result: FinancialResult) {
  const { version, key, installments, originalCents, buyerAdditionCents, buyerInterestCents, buyerTotalCents, installmentCents, lastInstallmentCents, contractedCostCents, netCents, differenceCents } = result;
  return { version, key, installments, originalCents, buyerAdditionCents, buyerInterestCents, buyerTotalCents, installmentCents, lastInstallmentCents, contractedCostCents, netCents, differenceCents };
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Campo financeiro não permitido'); }
function integer(value: unknown, max: number) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('Valor financeiro inválido'); }
export function validateKey(key: string) {
  const [acquirer, method, channel, n, extra] = key.split('/');
  if (!/^[A-Z][A-Z0-9_-]{0,39}$/.test(acquirer ?? '') || !METHODS.includes(method as Method) || !CHANNELS.includes(channel as Channel) || !/^(?:[1-9]|1[0-2])$/.test(n ?? '') || extra !== undefined || (method !== 'CREDIT_CARD' && n !== '1')) throw new Error('Modalidade/canal/parcela inválidos');
}
export function validatePolicy(value: unknown): asserts value is Policy {
  if (!record(value)) throw new Error('Configuração inválida');
  exact(value, ['schemaVersion', 'lanes', 'owner', 'interestFree', 'interestOnly', 'legacyAudit']);
  if (value.schemaVersion !== 1 || !record(value.lanes) || !record(value.owner) || (value.interestFree !== undefined && typeof value.interestFree !== 'boolean') || (value.interestOnly !== undefined && typeof value.interestOnly !== 'boolean')) throw new Error('Configuração inválida');
  if (Object.keys(value.lanes).length > 500 || Object.keys(value.owner).length > 500) throw new Error('Configuração excede limite');
  for (const [key, rule] of Object.entries(value.owner)) {
    validateKey(key);
    if (!record(rule)) throw new Error('Adicional inválido');
    exact(rule, ['fixedCents', 'ratePpm', 'passInterestPpm']);
    integer(rule.fixedCents, 1_000_000_000); integer(rule.ratePpm, 1_000_000); integer(rule.passInterestPpm, 1_000_000);
    if (!key.includes('/CREDIT_CARD/') && ![0, 1_000_000].includes(rule.passInterestPpm as number)) throw new Error('Repasse de juros exclusivo do crédito');
  }
  for (const [key, lane] of Object.entries(value.lanes)) {
    validateKey(key);
    if (!record(lane) || typeof lane.active !== 'boolean' || !record(lane.contract) || !record(lane.sim)) throw new Error('Taxas administrativas incompletas');
    exact(lane, ['active', 'contract', 'sim', 'total']);
    if (lane.total !== undefined) {
      if (!record(lane.total)) throw new Error('Custo total inválido');
      exact(lane.total, ['fixedCents', 'ratePpm']);
      integer(lane.total.fixedCents, 1_000_000_000); integer(lane.total.ratePpm, 1_000_000);
    }
    exact(lane.contract, ['fixedCents', 'ratePpm', 'cashbackCents', 'interestPpm', 'base', 'reference']); exact(lane.sim, ['fixedCents', 'ratePpm', 'interestPpm']);
    for (const part of [lane.contract, lane.sim]) { integer(part.fixedCents, 1_000_000_000); integer(part.ratePpm, 1_000_000); integer(part.interestPpm, 1_000_000); }
    integer(lane.contract.cashbackCents, 1_000_000_000);
    if (!['ORIGINAL', 'BUYER_TOTAL'].includes(String(lane.contract.base)) || typeof lane.contract.reference !== 'string' || lane.contract.reference.length > 200) throw new Error('Base ou referência de taxas inválida');
    if (!key.includes('/CREDIT_CARD/') && (lane.contract.interestPpm !== 0 || lane.sim.interestPpm !== 0)) throw new Error('Juros exclusivos do crédito');
  }
}
