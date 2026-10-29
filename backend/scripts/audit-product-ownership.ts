/**
 * Read-only audit of product ownership (plan 0009). Never writes to the database.
 *
 *   DATABASE_URL=... bun scripts/audit-product-ownership.ts [--out=report.json] [--mapping=mapping.json]
 *
 * Classifies each PaymentLink, SubscriptionLink, Plan, PixCreditPlan and Boleto as OK,
 * PROPOSE_TRANSFER (target = owner of the single active registered platform, or an explicit mapping
 * entry) or NEEDS_DECISION. Targets are never inferred from names, e-mails or descriptions.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import {
  PRODUCT_TYPES,
  classifyProduct,
  hostOf,
  normalizeTags,
  parseMapping,
  warningsFor,
  type Classification,
  type MappingEntry,
  type OwnerFacts,
  type PlatformFacts,
  type ProductFacts,
  type ProductType,
} from './product-ownership';

const AGREEMENT_KEY: Record<string, ProductType> = {
  'links-pagamento': 'PaymentLink',
  'links-assinatura': 'SubscriptionLink',
  boletos: 'Boleto',
  planos: 'Plan',
  'planos-pix': 'PixCreditPlan',
};
const SETTLED_ORDER_EXCLUDED = [
  'pending',
  'failed',
  'canceled',
  'cancelled',
  'expired',
  'refunded',
];

export type Stats = {
  transactions: number | null;
  settledNet: string | null;
  orders: number | null;
  activeOrders: number | null;
  allocations: number | null;
  adminAllocations: number | null;
  note?: string;
};
export type AuditRow = {
  productType: ProductType;
  productId: string;
  title: string | null;
  owner: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    isPurged: boolean;
    hasDocument: boolean;
  } | null;
  createdByUserId: string | null;
  tags: string[];
  platforms: {
    tag: string;
    registered: boolean;
    isActive: boolean;
    ownerUserId: string | null;
  }[];
  coproduction: {
    mode: string;
    participants: { id: string; email: string; role: string }[];
  } | null;
  stats: Stats;
  warnings: string[];
  classification: Classification;
};
export type AuditReport = {
  database: string;
  totals: Record<string, Record<string, number>>;
  products: AuditRow[];
  mappingTemplate: MappingEntry[];
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function runAudit(
  client: Client,
  database: string,
  mapping: MappingEntry[] = [],
): Promise<AuditReport> {
  await client.query('BEGIN READ ONLY');
  try {
    const q = async <T = any>(text: string, values: unknown[] = []) =>
      (await client.query(text, values)).rows as T[];
    const userRows = await q(
      `SELECT id, email, role::text AS role, "isActive", "isPurged",
              (coalesce(cpf, '') <> '' OR coalesce(cnpj, '') <> '') AS "hasDocument"
       FROM "User"`,
    );
    const users = new Map<string, OwnerFacts>(
      userRows.map((u) => [
        u.id,
        {
          ...u,
          isActive: !!u.isActive,
          isPurged: !!u.isPurged,
          hasDocument: !!u.hasDocument,
        },
      ]),
    );
    const byEmail = new Map<string, OwnerFacts>(
      [...users.values()].map((u) => [u.email.toLowerCase(), u]),
    );
    const platformRows = await q(
      `SELECT id, tag, "isActive", "ownerUserId" FROM "Platform"`,
    );
    const platforms = new Map<string, PlatformFacts>(
      platformRows.map((p) => [
        p.tag.toUpperCase(),
        { tag: p.tag, isActive: !!p.isActive, ownerUserId: p.ownerUserId },
      ]),
    );
    const platformIdByTag = new Map(
      platformRows.map((p) => [p.tag.toUpperCase(), p.id]),
    );

    const agreements = new Map<
      string,
      { mode: string; participants: { userId?: string; email?: string }[] }
    >();
    for (const a of await q(
      `SELECT product, "productId", mode, participants FROM "CoproductionAgreement"`,
    ))
      agreements.set(`${a.product}:${a.productId}`, {
        mode: a.mode ?? 'OWN',
        participants: a.participants ?? [],
      });

    const mappingByKey = new Map(
      mapping.map((m) => [`${m.productType}:${m.productId}`, m]),
    );
    const hasCreatedBy = new Set(
      (
        await q(
          `SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'createdByUserId'`,
        )
      ).map((r) => r.table_name),
    );

    const stats = await collectStats(q);
    const rows: AuditRow[] = [];
    for (const type of PRODUCT_TYPES) {
      const products = await q(`SELECT to_jsonb(t) AS row FROM "${type}" t`);
      for (const { row } of products) {
        const tags = normalizeTags(
          row.plataformas,
          row.platformTag,
          row.tenantTag,
        );
        const ownerFacts = users.get(row.userId) ?? null;
        const agreementKey = Object.entries(AGREEMENT_KEY).find(
          ([, v]) => v === type,
        )![0];
        let saved = agreements.get(`${agreementKey}:${row.id}`) ?? null;
        if (saved?.mode === 'INHERIT' || (!saved && tags.length === 1)) {
          const inherited =
            tags.length === 1 &&
            agreements.get(`plataformas:${platformIdByTag.get(tags[0])}`);
          if (saved?.mode === 'INHERIT' && inherited) saved = inherited;
        }
        const participants = saved
          ? saved.participants.map((p) => {
              const u = p.userId
                ? users.get(p.userId)
                : byEmail.get(String(p.email).toLowerCase());
              return {
                id: u?.id ?? p.userId ?? `unknown:${p.email}`,
                email: u?.email ?? String(p.email ?? ''),
                role: u?.role ?? 'UNKNOWN',
              };
            })
          : null;
        const facts: ProductFacts = {
          type,
          id: row.id,
          title: row.title ?? row.name ?? null,
          owner: ownerFacts,
          createdByUserId: hasCreatedBy.has(type)
            ? (row.createdByUserId ?? null)
            : null,
          tags,
          agreement: participants,
        };
        const explicit = mappingByKey.get(`${type}:${row.id}`)?.newOwnerUserId;
        const warnings = warningsFor(facts, platforms);
        if (!hasCreatedBy.has(type)) warnings.push('CREATED_BY_COLUMN_MISSING');
        rows.push({
          productType: type,
          productId: row.id,
          title: facts.title,
          owner: ownerFacts,
          createdByUserId: facts.createdByUserId,
          tags,
          platforms: tags.map((tag) => {
            const p = platforms.get(tag);
            return {
              tag,
              registered: !!p,
              isActive: !!p?.isActive,
              ownerUserId: p?.ownerUserId ?? null,
            };
          }),
          coproduction:
            saved && participants ? { mode: saved.mode, participants } : null,
          stats: stats(type, row.id),
          warnings: [...new Set(warnings)].sort(),
          classification: classifyProduct(facts, platforms, users, explicit),
        });
      }
    }
    rows.sort(
      (a, b) =>
        cmp(a.productType, b.productType) || cmp(a.productId, b.productId),
    );
    const totals: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      totals[r.productType] ??= {
        total: 0,
        OK: 0,
        PROPOSE_TRANSFER: 0,
        NEEDS_DECISION: 0,
        adminOwned: 0,
      };
      const t = totals[r.productType];
      t.total++;
      t[r.classification.status]++;
      if (r.owner?.role === 'ADMIN') t.adminOwned++;
    }
    const mappingTemplate: MappingEntry[] = rows.flatMap((r) =>
      r.classification.status === 'PROPOSE_TRANSFER'
        ? [
            {
              productType: r.productType,
              productId: r.productId,
              newOwnerUserId: r.classification.targetUserId,
              reason: r.classification.evidence,
              ...(r.owner ? { expectedFromUserId: r.owner.id } : {}),
            },
          ]
        : [],
    );
    return { database, totals, products: rows, mappingTemplate };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function collectStats(
  q: <T = any>(text: string, values?: unknown[]) => Promise<T[]>,
) {
  const tx = new Map(
    (
      await q(
        `SELECT "paymentLinkId" AS id, count(*)::int AS n,
            coalesce(sum("netAmount") FILTER (WHERE status = 'COMPLETED'), 0)::text AS net
     FROM "Transaction" WHERE "paymentLinkId" IS NOT NULL GROUP BY 1`,
      )
    ).map((r) => [r.id, r]),
  );
  const alloc = new Map(
    (
      await q(
        `SELECT t."paymentLinkId" AS id, count(*)::int AS n,
            count(*) FILTER (WHERE u.role::text = 'ADMIN')::int AS admins
     FROM "CoproductionAllocation" a
     JOIN "Transaction" t ON t.id = a."transactionId"
     JOIN "User" u ON u.id = a."userId"
     WHERE t."paymentLinkId" IS NOT NULL GROUP BY 1`,
      )
    ).map((r) => [r.id, r]),
  );
  const subOrders = new Map(
    (
      await q(
        `SELECT "subscriptionLinkId" AS id, count(*)::int AS n,
            count(*) FILTER (WHERE status <> ALL($1))::int AS active,
            coalesce(sum("amountCharged") FILTER (WHERE status <> ALL($1)), 0)::text AS net
     FROM "SubscriptionLinkOrder" GROUP BY 1`,
        [SETTLED_ORDER_EXCLUDED],
      )
    ).map((r) => [r.id, r]),
  );
  const subs = new Map(
    (
      await q(
        `SELECT "planId" AS id, count(*)::int AS n,
            count(*) FILTER (WHERE status = 'active')::int AS active
     FROM "Subscription" GROUP BY 1`,
      )
    ).map((r) => [r.id, r]),
  );
  const pix = new Map(
    (
      await q(
        `SELECT o."pixCreditPlanId" AS id, count(*)::int AS n,
            coalesce(sum(t."netAmount") FILTER (WHERE t.status = 'COMPLETED'), 0)::text AS net,
            count(a."transactionId")::int AS allocs,
            count(a."transactionId") FILTER (WHERE u.role::text = 'ADMIN')::int AS admins
     FROM "PixPlanOrder" o
     JOIN "Transaction" t ON t.id = o."transactionId"
     LEFT JOIN "CoproductionAllocation" a ON a."transactionId" = t.id
     LEFT JOIN "User" u ON u.id = a."userId"
     WHERE o."pixCreditPlanId" IS NOT NULL GROUP BY 1`,
      )
    ).map((r) => [r.id, r]),
  );
  return (type: ProductType, id: string): Stats => {
    const empty = {
      transactions: 0,
      settledNet: '0',
      orders: 0,
      activeOrders: 0,
      allocations: 0,
      adminAllocations: 0,
    };
    switch (type) {
      case 'PaymentLink': {
        const t = tx.get(id),
          a = alloc.get(id);
        return {
          ...empty,
          transactions: t?.n ?? 0,
          settledNet: t?.net ?? '0',
          allocations: a?.n ?? 0,
          adminAllocations: a?.admins ?? 0,
        };
      }
      case 'SubscriptionLink': {
        const o = subOrders.get(id);
        return {
          ...empty,
          orders: o?.n ?? 0,
          activeOrders: o?.active ?? 0,
          settledNet: o?.net ?? '0',
          note: 'settledNet = amountCharged of non-pending orders; allocations not linked to orders',
        };
      }
      case 'Plan': {
        const s = subs.get(id);
        return {
          ...empty,
          orders: s?.n ?? 0,
          activeOrders: s?.active ?? 0,
          note: 'orders = Subscription rows',
        };
      }
      case 'PixCreditPlan': {
        const p = pix.get(id);
        return {
          ...empty,
          orders: p?.n ?? 0,
          transactions: p?.n ?? 0,
          settledNet: p?.net ?? '0',
          allocations: p?.allocs ?? 0,
          adminAllocations: p?.admins ?? 0,
        };
      }
      default:
        return {
          transactions: null,
          settledNet: null,
          orders: null,
          activeOrders: null,
          allocations: null,
          adminAllocations: null,
          note: 'Boleto has no transaction link in the schema',
        };
    }
  };
}

export function renderTable(report: AuditReport): string {
  const lines = [`Database host: ${report.database}`, ''];
  for (const [type, t] of Object.entries(report.totals))
    lines.push(
      `${type}: total=${t.total} OK=${t.OK} PROPOSE_TRANSFER=${t.PROPOSE_TRANSFER} NEEDS_DECISION=${t.NEEDS_DECISION} adminOwned=${t.adminOwned}`,
    );
  lines.push('');
  for (const r of report.products) {
    const c = r.classification;
    const detail =
      c.status === 'PROPOSE_TRANSFER'
        ? `-> ${c.targetUserId} (${c.evidence})`
        : c.status === 'NEEDS_DECISION'
          ? c.reasons.join(' | ')
          : '';
    lines.push(
      [
        r.productType.padEnd(16),
        r.productId,
        (r.title ?? '').slice(0, 28).padEnd(28),
        `${r.owner?.role ?? '?'}${r.owner?.isActive === false ? '/inactive' : ''}${r.owner?.isPurged ? '/purged' : ''}`.padEnd(
          10,
        ),
        (r.tags.join(',') || '-').padEnd(20),
        `tx=${r.stats.transactions ?? 'n/a'} ord=${r.stats.orders ?? 'n/a'}/${r.stats.activeOrders ?? 'n/a'} alloc=${r.stats.allocations ?? 'n/a'} net=${r.stats.settledNet ?? 'n/a'}`,
        c.status,
        detail,
        r.warnings.length ? `[${r.warnings.join(',')}]` : '',
      ].join('  '),
    );
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const arg = (name: string) =>
    process.argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const mapping = arg('mapping')
    ? parseMapping(JSON.parse(readFileSync(arg('mapping')!, 'utf8')))
    : [];
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const report = await runAudit(client, hostOf(url), mapping);
    console.log(renderTable(report));
    if (arg('out'))
      writeFileSync(arg('out')!, JSON.stringify(report, null, 2) + '\n');
  } finally {
    await client.end();
  }
}
