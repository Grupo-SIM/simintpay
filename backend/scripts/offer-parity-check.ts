/**
 * Read-only parity check between the five legacy product tables and `Offer` (plan 0023, section 10).
 * Run it on a RESTORED COPY before and after each phase that writes (2, 4, 5, 6); it never writes.
 *
 *   bun --no-env-file scripts/offer-parity-check.ts --database-url=postgresql://...
 *   # snapshot the money totals before a phase, compare after it
 *   bun --no-env-file scripts/offer-parity-check.ts --database-url=... --save-baseline=before.json
 *   bun --no-env-file scripts/offer-parity-check.ts --database-url=... --baseline=before.json
 *   # machine-readable
 *   bun --no-env-file scripts/offer-parity-check.ts --database-url=... --json
 *
 * Checks (each divergence is an ERROR unless marked WARN; the exit code is 1 on any ERROR):
 *   COUNTS      legacy rows per table vs Offers with the same id (plus Offers with no legacy row, INFO)
 *   FIELDS      value/active/owner/code/methods/interval/... per field, by the legacy mappers
 *   USED_COUNT  Offer.usedCount vs currentUses (stale after the freeze: copy the delta again)
 *   TX_SUMS     Transaction count, amount and netAmount by status, method and product: the legacy key
 *               (paymentLinkId) against the Offer key (offerId)
 *   ORPHANS     rows whose product key points to no Offer, per key (and voucher/alias targets)
 *   COPRODUCTION agreements/revisions left under an old key or pointing to nothing
 *   EXTERNAL_REF DOM ids (domPaymentLinkId, domPlanId, live domSubscriptionId) carried by ExternalRef
 *               or BillingContract
 *   BASELINE    totals now vs a --baseline file (Transaction by status/method/product, Wallet
 *               balances, CoproductionAllocation by user)
 *
 * Tables are found under their own name or `<name>_legacy` (after phase 5); missing tables are skipped.
 * The connection is opened with default_transaction_read_only=on and `BEGIN READ ONLY`, and every
 * statement is checked to be a single SELECT/WITH/SHOW before it is sent.
 * The database must be given with `--database-url`; `DATABASE_URL` and `.env` are never read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import {
  type BoletoRow,
  mapBoleto,
  mapPaymentLink,
  mapPixCreditPlan,
  mapPlan,
  mapSubscriptionLink,
  type LegacyType,
  type OfferDraft,
  type PaymentLinkRow,
  type PixCreditPlanRow,
  type PlanRow,
  type SubscriptionLinkRow,
} from '../src/modules/offer/legacy-offer-mapper';

export type Severity = 'ERROR' | 'WARN' | 'INFO';
export type Finding = {
  severity: Severity;
  check: string;
  message: string;
  /** Row id the finding is about, when there is one (lets callers filter). */
  ref?: string;
};

export const KINDS: LegacyType[] = [
  'PaymentLink',
  'SubscriptionLink',
  'Plan',
  'PixCreditPlan',
  'Boleto',
];
const OLD_COPRODUCTION_KEYS = [
  'links-pagamento',
  'links-assinatura',
  'boletos',
  'planos',
  'planos-pix',
];
const TERMINAL_STATUSES = [
  'cancelled',
  'canceled',
  'inactive',
  'expired',
  'failed',
  'deactivated',
  'disabled',
];

// ---------------------------------------------------------------------------------------------
// Read-only guard
// ---------------------------------------------------------------------------------------------

/** Removes comments, string literals and quoted identifiers so keywords inside them are ignored. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

const WRITE_KEYWORDS =
  /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|call|do|merge|lock|vacuum|analyze|refresh|reindex|cluster|comment|set|reset|listen|notify|prepare|execute|into|for\s+(update|share|no\s+key\s+update|key\s+share))\b/i;

/** Throws unless `sql` is exactly one read statement (SELECT, WITH ... SELECT or SHOW). */
export function assertReadOnlySql(sql: string): void {
  const bare = stripLiterals(sql).trim().replace(/;\s*$/, '');
  if (!/^(select|with|show)\b/i.test(bare))
    throw new Error(
      `Refused: only SELECT/WITH/SHOW is allowed, got: ${sql.slice(0, 60)}`,
    );
  if (bare.includes(';'))
    throw new Error('Refused: multiple statements are not allowed');
  const hit = WRITE_KEYWORDS.exec(bare);
  if (hit)
    throw new Error(`Refused: "${hit[0]}" is not allowed in a read-only check`);
}

export type Db = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
};

/** Wraps a connected client already inside `BEGIN READ ONLY`. */
export function readOnlyDb(client: Pick<Client, 'query'>): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      assertReadOnlySql(sql);
      const result = await client.query(sql, params);
      return result.rows as T[];
    },
  };
}

export async function connectReadOnly(
  url: string,
): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new Client({
    connectionString: url,
    options: '-c default_transaction_read_only=on',
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const db = readOnlyDb(client);
    const [{ transaction_read_only }] = await db.query<{
      transaction_read_only: string;
    }>('SHOW transaction_read_only');
    if (transaction_read_only !== 'on')
      throw new Error('Refused: the transaction is not READ ONLY');
    await db.query("SELECT set_config('statement_timeout', '300000', true)");
    return {
      db,
      close: async () => {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.end();
      },
    };
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Name a table currently has: its own or `<name>_legacy`; null when neither exists. */
export async function resolveTable(
  db: Db,
  name: string,
): Promise<string | null> {
  for (const candidate of [name, `${name}_legacy`]) {
    const [row] = await db.query<{ ok: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS ok',
      [`public.${q(candidate)}`],
    );
    if (row.ok) return candidate;
  }
  return null;
}

async function columnExists(db: Db, table: string, column: string) {
  const [row] = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS ok`,
    [table, column],
  );
  return row.ok;
}

export function normDecimal(value: unknown): string {
  if (value === null || value === undefined) return '0';
  const text = String(value);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '') || '0';
}

/** Exact decimal addition on strings (no float drift in money sums). */
export function addDecimal(a: string, b: string): string {
  const scale = 8;
  const toInt = (v: string) => {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim());
    if (!m) throw new Error(`not a decimal: ${v}`);
    const n = BigInt(m[2] + (m[3] ?? '').padEnd(scale, '0').slice(0, scale));
    return m[1] ? -n : n;
  };
  const sum = toInt(a) + toInt(b);
  const neg = sum < 0n;
  const abs = (neg ? -sum : sum).toString().padStart(scale + 1, '0');
  return normDecimal(
    `${neg ? '-' : ''}${abs.slice(0, -scale)}.${abs.slice(-scale)}`,
  );
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value as Row)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

const pick = (value: unknown, keys: string[]): Row | null => {
  if (!value || typeof value !== 'object') return null;
  const out: Row = {};
  for (const key of keys) {
    const v = (value as Row)[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
};

type Ctx = {
  db: Db;
  findings: Finding[];
  /** Printable tables (title, lines). */
  report: { title: string; lines: string[] }[];
  tables: Map<string, string | null>;
  /** legacy id -> kind, for every legacy row found. */
  legacyKind: Map<string, LegacyType>;
  skipFields: Set<string>;
};

const add = (ctx: Ctx, f: Finding) => ctx.findings.push(f);
const tbl = (ctx: Ctx, name: string) => ctx.tables.get(name) ?? null;
const sample = (ids: string[], max = 5) =>
  ids.slice(0, max).join(', ') +
  (ids.length > max ? `, ... (+${ids.length - max})` : '');

// ---------------------------------------------------------------------------------------------
// 1. Counts + 2. fields + usedCount
// ---------------------------------------------------------------------------------------------

type Mapped = { kind: LegacyType; id: string; draft: OfferDraft };

async function loadLegacyDrafts(ctx: Ctx): Promise<Mapped[]> {
  const out: Mapped[] = [];
  const fetchAll = async (name: string) => {
    const table = tbl(ctx, name);
    return table
      ? ctx.db.query<Row>(`SELECT * FROM ${q(table)} ORDER BY id`)
      : [];
  };
  for (const row of await fetchAll('PaymentLink'))
    out.push({
      kind: 'PaymentLink',
      id: String(row.id),
      draft: mapPaymentLink(row as unknown as PaymentLinkRow),
    });
  for (const row of await fetchAll('SubscriptionLink'))
    out.push({
      kind: 'SubscriptionLink',
      id: String(row.id),
      draft: mapSubscriptionLink(row as unknown as SubscriptionLinkRow),
    });
  for (const row of await fetchAll('Plan'))
    out.push({
      kind: 'Plan',
      id: String(row.id),
      draft: mapPlan(row as unknown as PlanRow),
    });
  for (const row of await fetchAll('Boleto'))
    out.push({
      kind: 'Boleto',
      id: String(row.id),
      draft: mapBoleto(row as unknown as BoletoRow),
    });
  const pix = await fetchAll('PixCreditPlan');
  if (pix.length) {
    const codeTable = tbl(ctx, 'PixPlanLinkCode');
    const codes = codeTable
      ? await ctx.db.query<Row>(`SELECT * FROM ${q(codeTable)}`)
      : [];
    for (const row of pix) {
      const linkCodes = codes
        .filter((c) => c.pixCreditPlanId === row.id)
        .map((c) => ({
          code: String(c.code),
          isActive: c.isActive as boolean,
          createdAt: c.createdAt as Date,
        }));
      out.push({
        kind: 'PixCreditPlan',
        id: String(row.id),
        draft: mapPixCreditPlan({
          ...row,
          linkCodes,
        } as unknown as PixCreditPlanRow),
      });
    }
  }
  for (const m of out) ctx.legacyKind.set(m.id, m.kind);
  return out;
}

const COMPARED_FIELDS = [
  'ownerUserId',
  'createdByUserId',
  'platformTag',
  'code',
  'name',
  'description',
  'amountCents',
  'isActive',
  'acceptedMethods',
  'maxInstallments',
  'expiresAt',
  'maxUses',
  'renewalMode',
  'intervalType',
  'intervalCount',
  'repetitions',
  'retryDays',
  'fulfillment',
  'metadata',
] as const;

async function checkCountsAndFields(ctx: Ctx, mapped: Mapped[]) {
  const ids = mapped.map((m) => m.id);
  const offers = ids.length
    ? await ctx.db.query<Row>(
        'SELECT *, "acceptedMethods"::text[] AS "acceptedMethodList" FROM "Offer" WHERE id = ANY($1::text[])',
        [ids],
      )
    : [];
  const byId = new Map(offers.map((o) => [String(o.id), o]));
  const [{ n: offerTotal }] = await ctx.db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM "Offer"',
  );

  const lines: string[] = [];
  for (const kind of KINDS) {
    const mine = mapped.filter((m) => m.kind === kind);
    const missing = mine.filter((m) => !byId.has(m.id));
    const table = tbl(ctx, kind);
    lines.push(
      `${kind.padEnd(17)} ${table === null ? 'table absent' : `${String(mine.length).padStart(6)} legacy  ${String(mine.length - missing.length).padStart(6)} with Offer  ${String(missing.length).padStart(4)} missing`}`,
    );
    for (const m of missing)
      add(ctx, {
        severity: 'ERROR',
        check: 'COUNTS',
        ref: m.id,
        message: `${kind} ${m.id} (code ${m.draft.code ?? '-'}) has no Offer with the same id`,
      });
  }
  const native = Number(offerTotal) - offers.length;
  lines.push(
    `Offer total ${offerTotal}; ${native} without a legacy row (native offers, INFO)`,
  );
  ctx.report.push({ title: 'COUNTS', lines });

  // Duplicate ids across the five tables (one id cannot be two offers).
  const seen = new Map<string, LegacyType[]>();
  for (const m of mapped) seen.set(m.id, [...(seen.get(m.id) ?? []), m.kind]);
  for (const [id, kinds] of seen)
    if (kinds.length > 1)
      add(ctx, {
        severity: 'ERROR',
        check: 'COUNTS',
        ref: id,
        message: `id ${id} is in ${kinds.join(' and ')}`,
      });

  // Fields.
  const perField = new Map<string, number>();
  for (const m of mapped) {
    const offer = byId.get(m.id);
    if (!offer) continue;
    for (const issue of m.draft.issueDetails.length
      ? m.draft.issueDetails
      : m.draft.issues)
      add(ctx, {
        severity: 'ERROR',
        check: 'FIELDS',
        ref: m.id,
        message: `${m.kind} ${m.id} does not map cleanly: ${issue}`,
      });
    const draft = m.draft as unknown as Row;
    for (const field of COMPARED_FIELDS) {
      if (ctx.skipFields.has(field)) continue;
      let expected: unknown = draft[field];
      let actual: unknown =
        field === 'acceptedMethods' ? offer.acceptedMethodList : offer[field];
      if (field === 'acceptedMethods') {
        expected = [...((expected as string[]) ?? [])].sort();
        actual = [...((actual as string[] | null) ?? [])].sort();
      }
      // Offers gain keys after the migration (files, bumps, access rules); compare what the legacy row carried.
      if (field === 'fulfillment')
        actual = pick(actual, ['redirectUrl', 'emailBody']);
      if (field === 'metadata')
        actual = pick(actual, ['boletoDueDays', 'requiresBuyerAddress']);
      if (canonical(expected) !== canonical(actual)) {
        perField.set(field, (perField.get(field) ?? 0) + 1);
        add(ctx, {
          severity: 'ERROR',
          check: 'FIELDS',
          ref: m.id,
          message: `${m.kind} ${m.id}: ${field} legacy=${canonical(expected)} offer=${canonical(actual)}`,
        });
      }
    }
    if (
      !ctx.skipFields.has('usedCount') &&
      m.draft.usedCount !== offer.usedCount
    )
      add(ctx, {
        severity: 'ERROR',
        check: 'USED_COUNT',
        ref: m.id,
        message: `${m.kind} ${m.id}: currentUses=${m.draft.usedCount} but Offer.usedCount=${String(offer.usedCount)}`,
      });
  }
  if (perField.size)
    ctx.report.push({
      title: 'FIELDS (divergences per field)',
      lines: [...perField].map(([f, n]) => `${f.padEnd(18)} ${n}`),
    });
}

// ---------------------------------------------------------------------------------------------
// 3. Transaction sums
// ---------------------------------------------------------------------------------------------

type Agg = { count: string; amount: string; net: string };

async function txAggregates(ctx: Ctx, keyExpr: string, where: string) {
  const rows = await ctx.db.query<Row>(
    `SELECT status::text AS status, "paymentMethod"::text AS method, ${keyExpr} AS product,
            count(*)::text AS count, coalesce(sum(amount), 0)::text AS amount,
            coalesce(sum("netAmount"), 0)::text AS net
       FROM "Transaction" WHERE ${where}
      GROUP BY 1, 2, 3`,
  );
  return new Map<string, Agg>(
    rows.map((r) => [
      `${r.status}|${r.method ?? '-'}|${r.product}`,
      {
        count: String(r.count),
        amount: normDecimal(r.amount),
        net: normDecimal(r.net),
      },
    ]),
  );
}

async function checkTransactions(ctx: Ctx) {
  if (!(await columnExists(ctx.db, 'Transaction', 'paymentLinkId'))) {
    ctx.report.push({
      title: 'TX_SUMS',
      lines: [
        'Transaction.paymentLinkId is gone (phase 6): only --baseline can compare totals',
      ],
    });
    return;
  }
  const legacy = await txAggregates(
    ctx,
    '"paymentLinkId"',
    '"paymentLinkId" IS NOT NULL',
  );
  const offer = await txAggregates(
    ctx,
    '"offerId"',
    '"paymentLinkId" IS NOT NULL AND "offerId" IS NOT NULL',
  );
  const lines: string[] = [];
  const keys = new Set([...legacy.keys(), ...offer.keys()]);
  const byKind = new Map<string, Agg>();
  for (const key of [...keys].sort()) {
    const a = legacy.get(key);
    const b = offer.get(key);
    const [status, method, product] = key.split('|');
    if (
      !a ||
      !b ||
      a.count !== b.count ||
      a.amount !== b.amount ||
      a.net !== b.net
    )
      add(ctx, {
        severity: 'ERROR',
        check: 'TX_SUMS',
        ref: product,
        message: `status=${status} method=${method} product=${product}: legacy key ${a ? `${a.count} tx amount ${a.amount} net ${a.net}` : 'none'} vs Offer key ${b ? `${b.count} tx amount ${b.amount} net ${b.net}` : 'none'}`,
      });
    if (a) {
      const kind = ctx.legacyKind.get(product) ?? 'unknown';
      const gk = `${kind}|${status}|${method}`;
      const prev = byKind.get(gk) ?? { count: '0', amount: '0', net: '0' };
      byKind.set(gk, {
        count: String(Number(prev.count) + Number(a.count)),
        amount: addDecimal(prev.amount, a.amount),
        net: addDecimal(prev.net, a.net),
      });
    }
  }
  for (const [gk, v] of [...byKind].sort())
    lines.push(
      `${gk.replace(/\|/g, ' / ').padEnd(48)} ${v.count.padStart(6)} tx  amount ${v.amount}  net ${v.net}`,
    );
  const [extra] = await ctx.db.query<{ only_offer: string; none: string }>(
    `SELECT count(*) FILTER (WHERE "paymentLinkId" IS NULL AND "offerId" IS NOT NULL)::text AS only_offer,
            count(*) FILTER (WHERE "paymentLinkId" IS NULL AND "offerId" IS NULL)::text AS none
       FROM "Transaction"`,
  );
  lines.push(
    `Transactions only on the Offer key: ${extra.only_offer}; with no product: ${extra.none} (INFO)`,
  );
  ctx.report.push({
    title:
      'TX_SUMS (legacy key paymentLinkId, by product kind / status / method)',
    lines,
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Orphans
// ---------------------------------------------------------------------------------------------

const ORPHAN_KEYS: [table: string, column: string][] = [
  ['Transaction', 'paymentLinkId'],
  ['Transaction', 'offerId'],
  ['SubscriptionLinkOrder', 'subscriptionLinkId'],
  ['Subscription', 'planId'],
  ['PixPlanOrder', 'pixCreditPlanId'],
  ['PixPlanLinkCode', 'pixCreditPlanId'],
  ['CustomerPlanAccess', 'pixPlanId'],
  ['PaymentLinkOffer', 'paymentLinkId'],
  ['PaymentLinkFile', 'paymentLinkId'],
  ['PaymentLinkOfferSale', 'paymentLinkId'],
  ['BillingContract', 'offerId'],
  ['Charge', 'offerId'],
  ['OfferAccess', 'offerId'],
  ['OfferCodeAlias', 'offerId'],
];

async function checkOrphans(ctx: Ctx) {
  const lines: string[] = [];
  for (const [name, column] of ORPHAN_KEYS) {
    const table = tbl(ctx, name);
    if (!table || !(await columnExists(ctx.db, table, column))) {
      lines.push(`${`${name}.${column}`.padEnd(40)} skipped (absent)`);
      continue;
    }
    const rows = await ctx.db.query<{ v: string }>(
      `SELECT DISTINCT ${q(column)} AS v FROM ${q(table)} t
        WHERE t.${q(column)} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = t.${q(column)}) LIMIT 1000`,
    );
    lines.push(`${`${name}.${column}`.padEnd(40)} ${rows.length} orphan id(s)`);
    for (const r of rows)
      add(ctx, {
        severity: 'ERROR',
        check: 'ORPHANS',
        ref: r.v,
        message: `${name}.${column}=${r.v} points to no Offer`,
      });
  }
  ctx.report.push({ title: 'ORPHANS (key -> Offer.id)', lines });

  // Public PX- codes of the PIX plan must resolve to an Offer (its code or an alias).
  const codeTable = tbl(ctx, 'PixPlanLinkCode');
  if (codeTable) {
    const rows = await ctx.db.query<{ code: string }>(
      `SELECT c.code FROM ${q(codeTable)} c
        WHERE NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.code = c.code)
          AND NOT EXISTS (SELECT 1 FROM "OfferCodeAlias" a WHERE a.code = c.code)`,
    );
    for (const r of rows)
      add(ctx, {
        severity: 'ERROR',
        check: 'ORPHANS',
        ref: r.code,
        message: `PixPlanLinkCode ${r.code} is neither an Offer.code nor an OfferCodeAlias`,
      });
  }

  // Vouchers bound to a product that no longer resolves.
  const vouchers = await ctx.db.query<{
    code: string;
    link: string[];
    plans: string[];
  }>(
    `SELECT code, "allowedLinkCodes" AS link, "applicablePlans" AS plans FROM "Voucher"`,
  );
  if (vouchers.length) {
    const known = new Set<string>();
    for (const r of await ctx.db.query<{ v: string }>(
      `SELECT lower(id) AS v FROM "Offer" UNION SELECT lower(code) FROM "Offer"
       UNION SELECT lower(code) FROM "OfferCodeAlias"`,
    ))
      known.add(r.v);
    for (const v of vouchers)
      for (const target of [...(v.link ?? []), ...(v.plans ?? [])])
        if (!known.has(String(target).toLowerCase()))
          add(ctx, {
            severity: 'WARN',
            check: 'ORPHANS',
            ref: v.code,
            message: `Voucher ${v.code} targets ${target}, which is no Offer id/code/alias`,
          });
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Coproduction
// ---------------------------------------------------------------------------------------------

async function checkCoproduction(ctx: Ctx) {
  const legacyIds = [...ctx.legacyKind.keys()];
  for (const table of ['CoproductionAgreement', 'CoproductionRevision']) {
    const old = await ctx.db.query<{ product: string; id: string }>(
      `SELECT DISTINCT product, "productId" AS id FROM ${q(table)} WHERE product = ANY($1::text[])`,
      [OLD_COPRODUCTION_KEYS],
    );
    for (const r of old) {
      const [{ ok }] = await ctx.db.query<{ ok: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM "Offer" WHERE id = $1) AS ok',
        [r.id],
      );
      add(ctx, {
        severity: 'ERROR',
        check: 'COPRODUCTION',
        ref: r.id,
        message: ok
          ? `${table} ${r.product}/${r.id} still under the old key although the Offer exists (not renamed to 'ofertas')`
          : `${table} ${r.product}/${r.id} points to no Offer${legacyIds.includes(r.id) ? ' (legacy row exists but was not migrated)' : ' and no legacy row'}`,
      });
    }
    const dangling = await ctx.db.query<{ id: string }>(
      `SELECT DISTINCT "productId" AS id FROM ${q(table)} a
        WHERE product = 'ofertas' AND NOT EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = a."productId")`,
    );
    for (const r of dangling)
      add(ctx, {
        severity: 'ERROR',
        check: 'COPRODUCTION',
        ref: r.id,
        message: `${table} ofertas/${r.id} points to no Offer`,
      });
  }
}

// ---------------------------------------------------------------------------------------------
// 6. ExternalRef (DOM)
// ---------------------------------------------------------------------------------------------

async function checkExternalRefs(ctx: Ctx) {
  const wanted: {
    id: string;
    kind: 'PAYMENT_LINK' | 'PLAN';
    ext: string | null;
    from: string;
  }[] = [];
  const sources: [string, string, 'PAYMENT_LINK' | 'PLAN'][] = [
    ['PaymentLink', 'domPaymentLinkId', 'PAYMENT_LINK'],
    ['Boleto', 'domPaymentLinkId', 'PAYMENT_LINK'],
    ['SubscriptionLink', 'domPlanId', 'PLAN'],
    ['Plan', 'domPlanId', 'PLAN'],
  ];
  for (const [name, column, kind] of sources) {
    const table = tbl(ctx, name);
    if (!table) continue;
    for (const r of await ctx.db.query<{ id: string; ext: string | null }>(
      `SELECT id, ${q(column)} AS ext FROM ${q(table)}`,
    ))
      wanted.push({ id: r.id, kind, ext: r.ext, from: `${name}.${column}` });
  }
  const refs = await ctx.db.query<{
    kind: string;
    externalId: string;
    entityId: string;
  }>(
    `SELECT kind, "externalId", "entityId" FROM "ExternalRef"
      WHERE "acquirerCode" = 'DOM' AND "entityType" = 'Offer' AND kind IN ('PAYMENT_LINK', 'PLAN')`,
  );
  const byExternal = new Map(
    refs.map((r) => [`${r.kind}:${r.externalId}`, r.entityId]),
  );
  const byEntity = new Map<string, Set<string>>();
  for (const r of refs) {
    const key = `${r.kind}:${r.entityId}`;
    byEntity.set(key, (byEntity.get(key) ?? new Set()).add(r.externalId));
  }
  let checked = 0;
  for (const w of wanted) {
    if (w.ext) {
      checked++;
      const target = byExternal.get(`${w.kind}:${w.ext}`);
      if (target === undefined)
        add(ctx, {
          severity: 'ERROR',
          check: 'EXTERNAL_REF',
          ref: w.id,
          message: `${w.from}=${w.ext} of ${w.id} has no ExternalRef(DOM, ${w.kind}) pointing to the Offer`,
        });
      else if (target !== w.id)
        add(ctx, {
          severity: 'ERROR',
          check: 'EXTERNAL_REF',
          ref: w.id,
          message: `${w.from}=${w.ext} of ${w.id} points to Offer ${target}`,
        });
    }
    const set = byEntity.get(`${w.kind}:${w.id}`);
    if (set && (!w.ext || !set.has(w.ext)))
      add(ctx, {
        severity: 'ERROR',
        check: 'EXTERNAL_REF',
        ref: w.id,
        message: `ExternalRef(DOM, ${w.kind}) of Offer ${w.id} is [${[...set].join(', ')}] but ${w.from}=${w.ext ?? 'null'}`,
      });
  }

  // Live DOM subscriptions must still be findable (webhooks look them up by id).
  let live = 0;
  for (const [name, idColumn] of [
    ['SubscriptionLinkOrder', 'domSubscriptionId'],
    ['Subscription', 'domSubscriptionId'],
  ] as const) {
    const table = tbl(ctx, name);
    if (!table) continue;
    const rows = await ctx.db.query<{ id: string; ext: string }>(
      `SELECT t.id, t.${q(idColumn)} AS ext FROM ${q(table)} t
        WHERE t.${q(idColumn)} IS NOT NULL AND lower(t.status) <> ALL($1::text[])
          AND NOT EXISTS (SELECT 1 FROM "BillingContract" c WHERE c."externalSubscriptionId" = t.${q(idColumn)})
          AND NOT EXISTS (SELECT 1 FROM "ExternalRef" r WHERE r."acquirerCode" = 'DOM'
                           AND r.kind = 'SUBSCRIPTION' AND r."externalId" = t.${q(idColumn)})`,
      [TERMINAL_STATUSES],
    );
    live += rows.length;
    for (const r of rows)
      add(ctx, {
        severity: 'ERROR',
        check: 'EXTERNAL_REF',
        ref: r.id,
        message: `${name} ${r.id}: live DOM subscription ${r.ext} has no BillingContract or ExternalRef(SUBSCRIPTION)`,
      });
  }
  ctx.report.push({
    title: 'EXTERNAL_REF',
    lines: [
      `${checked} DOM link/plan id(s) checked; ${live} live DOM subscription(s) without a contract`,
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// 7. Baseline (before/after totals)
// ---------------------------------------------------------------------------------------------

export type Baseline = {
  generatedAt: string;
  transactions: Record<string, Agg>;
  wallets: Record<string, string>;
  coproductionAllocations: Record<string, { count: string; amount: string }>;
};

export async function collectBaseline(db: Db): Promise<Baseline> {
  const productKey = (await columnExists(db, 'Transaction', 'paymentLinkId'))
    ? `coalesce("offerId", "paymentLinkId", '-')`
    : `coalesce("offerId", '-')`;
  const tx = await db.query<Row>(
    `SELECT status::text AS status, "paymentMethod"::text AS method,
            ${productKey} AS product,
            count(*)::text AS count, coalesce(sum(amount), 0)::text AS amount,
            coalesce(sum("netAmount"), 0)::text AS net
       FROM "Transaction" GROUP BY 1, 2, 3`,
  );
  const wallets = await db.query<{
    userId: string;
    balance: string;
    locked: string;
  }>(
    `SELECT "userId", balance::text AS balance, "lockedBalance"::text AS locked FROM "Wallet"`,
  );
  const allocs = await db.query<{
    userId: string;
    state: string;
    count: string;
    amount: string;
  }>(
    `SELECT "userId", state, count(*)::text AS count, coalesce(sum(amount), 0)::text AS amount
       FROM "CoproductionAllocation" GROUP BY 1, 2`,
  );
  return {
    generatedAt: new Date().toISOString(),
    transactions: Object.fromEntries(
      tx.map((r) => [
        `${r.status}|${r.method ?? '-'}|${r.product}`,
        {
          count: String(r.count),
          amount: normDecimal(r.amount),
          net: normDecimal(r.net),
        },
      ]),
    ),
    wallets: Object.fromEntries(
      wallets.map((w) => [
        w.userId,
        `${normDecimal(w.balance)}|${normDecimal(w.locked)}`,
      ]),
    ),
    coproductionAllocations: Object.fromEntries(
      allocs.map((a) => [
        `${a.userId}|${a.state}`,
        { count: String(a.count), amount: normDecimal(a.amount) },
      ]),
    ),
  };
}

export function compareBaseline(before: Baseline, after: Baseline): Finding[] {
  const out: Finding[] = [];
  const diff = <T>(
    section: string,
    a: Record<string, T>,
    b: Record<string, T>,
    show: (v: T | undefined) => string,
  ) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (canonical(a[key]) !== canonical(b[key]))
        out.push({
          severity: 'ERROR',
          check: 'BASELINE',
          ref: key,
          message: `${section} ${key}: before ${show(a[key])} -> now ${show(b[key])}`,
        });
  };
  diff('Transaction', before.transactions, after.transactions, (v) =>
    v ? `${v.count} tx amount ${v.amount} net ${v.net}` : 'none',
  );
  diff('Wallet', before.wallets, after.wallets, (v) => v ?? 'none');
  diff(
    'CoproductionAllocation',
    before.coproductionAllocations,
    after.coproductionAllocations,
    (v) => (v ? `${v.count} amount ${v.amount}` : 'none'),
  );
  return out;
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

export type ParityOptions = {
  baseline?: Baseline;
  skipFields?: string[];
};

export async function runParity(
  db: Db,
  options: ParityOptions = {},
): Promise<{ findings: Finding[]; report: Ctx['report']; baseline: Baseline }> {
  const ctx: Ctx = {
    db,
    findings: [],
    report: [],
    tables: new Map(),
    legacyKind: new Map(),
    skipFields: new Set(options.skipFields ?? []),
  };
  for (const name of [
    ...KINDS,
    'SubscriptionLinkOrder',
    'Subscription',
    'PixPlanOrder',
    'PixPlanLinkCode',
    'CustomerPlanAccess',
    'PaymentLinkOffer',
    'PaymentLinkFile',
    'PaymentLinkOfferSale',
  ])
    ctx.tables.set(name, await resolveTable(db, name));
  // "Transaction", "Offer" and friends are never renamed.
  for (const name of [
    'Transaction',
    'BillingContract',
    'Charge',
    'OfferAccess',
    'OfferCodeAlias',
  ])
    ctx.tables.set(name, name);

  const mapped = await loadLegacyDrafts(ctx);
  await checkCountsAndFields(ctx, mapped);
  await checkTransactions(ctx);
  await checkOrphans(ctx);
  await checkCoproduction(ctx);
  await checkExternalRefs(ctx);
  const baseline = await collectBaseline(db);
  if (options.baseline)
    ctx.findings.push(...compareBaseline(options.baseline, baseline));
  return { findings: ctx.findings, report: ctx.report, baseline };
}

export type CliOptions = {
  databaseUrl: string;
  json: boolean;
  baselinePath?: string;
  saveBaselinePath?: string;
  skipFields: string[];
};

export function parseArgs(argv: string[]): CliOptions {
  const value = (name: string) => {
    const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
    if (i < 0) return undefined;
    return argv[i].includes('=') ? argv[i].slice(name.length + 1) : argv[i + 1];
  };
  const databaseUrl = value('--database-url')?.trim();
  if (!databaseUrl || databaseUrl.startsWith('--'))
    throw new Error(
      'Refusing to run: pass --database-url=<url>. DATABASE_URL and .env are never used.',
    );
  return {
    databaseUrl,
    json: argv.includes('--json'),
    baselinePath: value('--baseline'),
    saveBaselinePath: value('--save-baseline'),
    skipFields: (value('--skip-fields') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

function describeTarget(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { db, close } = await connectReadOnly(options.databaseUrl);
  try {
    const baseline = options.baselinePath
      ? (JSON.parse(readFileSync(options.baselinePath, 'utf8')) as Baseline)
      : undefined;
    const result = await runParity(db, {
      baseline,
      skipFields: options.skipFields,
    });
    if (options.saveBaselinePath)
      writeFileSync(
        options.saveBaselinePath,
        JSON.stringify(result.baseline, null, 2),
      );
    const errors = result.findings.filter((f) => f.severity === 'ERROR');
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ok: errors.length === 0,
            findings: result.findings,
            report: result.report,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `Target database: ${describeTarget(options.databaseUrl)} (READ ONLY)`,
      );
      for (const section of result.report) {
        console.log(`\n== ${section.title}`);
        for (const line of section.lines) console.log(`  ${line}`);
      }
      const shown = result.findings.filter((f) => f.severity !== 'INFO');
      console.log(
        `\n== DIVERGENCES (${errors.length} error(s), ${shown.length - errors.length} warning(s))`,
      );
      for (const f of shown)
        console.log(
          `  ${f.severity.padEnd(5)} ${f.check.padEnd(13)} ${f.message}`,
        );
      if (options.saveBaselinePath)
        console.log(`\nBaseline saved to ${options.saveBaselinePath}`);
      console.log(errors.length ? '\nPARITY FAILED' : '\nPARITY OK');
    }
    if (errors.length) process.exitCode = 1;
  } finally {
    await close();
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.stack || error.message : error,
    );
    process.exit(1);
  });
