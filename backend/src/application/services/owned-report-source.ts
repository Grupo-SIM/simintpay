import { Prisma } from '@prisma/client';
import { reportBuyerCpfSql } from '../helpers/report-buyer.helper';

type PlatformScope = { id: string; tag: string; ownerUserId: string }[];
type Period = { start?: Date; end?: Date; paymentMethod?: string };

/** Normalize aliases before testing exclusivity; never pick the first of conflicting tags. */
function canonical(value: Prisma.Sql) {
  return Prisma.sql`CASE WHEN upper(replace(${value}, '_', '-')) = 'EBOOKSIM' THEN 'EBOOK' ELSE upper(replace(${value}, '_', '-')) END`;
}
/** Stored Transaction.platformTag is the only platform source; description markers are never parsed. */
function reportMarkerTags() {
  return Prisma.sql`CASE WHEN t."platformTag" IS NULL THEN ARRAY[]::text[] ELSE ARRAY[t."platformTag"] END`;
}
function period(alias: Prisma.Sql, filters: Period) {
  return Prisma.sql`${filters.start ? Prisma.sql`AND ${alias}."createdAt" >= ${filters.start}` : Prisma.empty}
    ${filters.end ? Prisma.sql`AND ${alias}."createdAt" < ${filters.end}` : Prisma.empty}
    ${filters.paymentMethod ? Prisma.sql`AND ${alias}."paymentMethod"::text = ${filters.paymentMethod}` : Prisma.empty}`;
}

/** One projection for cards, charts and details. Reads only; never changes historical wallets. */
export function ownedReportSource(scope: PlatformScope, filters: Period) {
  // Offer.id is the legacy product id; offers carry a single tag.
  const linkTags = Prisma.sql`ARRAY(SELECT DISTINCT ${canonical(Prisma.sql`l."platformTag"`)} WHERE l."platformTag" IS NOT NULL AND l."platformTag" <> '')`;
  const saleLinkId = Prisma.sql`t."offerId"`;
  const ids = scope.map((p) => p.id);
  const selected = ids.length
    ? Prisma.sql`p.id IN (${Prisma.join(ids)})`
    : Prisma.sql`false`;
  return Prisma.sql`
    SELECT t.id, t."userId", t."createdAt", t.status::text AS status, t."paymentMethod"::text AS "paymentMethod",
      t.amount, CASE WHEN t."financialSnapshot" ? 'coproduction' THEN t."netAmount" - coalesce((
        SELECT sum(floor(coalesce((t."financialSnapshot" #>> '{coproduction,baseCents}')::numeric, t."netAmount" * 100) * (participant->>'percentageBps')::numeric / 10000) / 100)
        FROM jsonb_array_elements(t."financialSnapshot" #> '{coproduction,participants}') participant
      ), 0) ELSE t."netAmount" END AS "netAmount",
      CASE WHEN t."netAmount" IS NOT NULL THEN t.amount - t."netAmount" ELSE t."totalFee" END AS "totalFee",
      p.tag AS "platformTag",
      ${reportBuyerCpfSql(Prisma.sql`t."customerDocument"`)} AS "customerKey",
      CASE WHEN t."financialSnapshot"->>'buyerInterestCents' ~ '^[0-9]+$' THEN (t."financialSnapshot"->>'buyerInterestCents')::numeric / 100
        WHEN t."paymentMethod"::text <> 'CREDIT_CARD' THEN 0 ELSE NULL END AS interest,
      t.description, t."customerName"
    FROM "Transaction" t
    LEFT JOIN "Offer" l ON l.id = ${saleLinkId}
    CROSS JOIN LATERAL (SELECT ${reportMarkerTags()} AS tags) marker
    CROSS JOIN LATERAL (SELECT ${linkTags} AS tags) link
    JOIN "Platform" p ON (
      CASE WHEN t.tracking ? 'reportAttribution' THEN
        t.tracking #>> '{reportAttribution,platformId}' = p.id
        AND t.tracking #>> '{reportAttribution,ownerUserId}' = p."ownerUserId"
        AND t.tracking #>> '{reportAttribution,beneficiaryUserId}' = t."userId"
        AND marker.tags = ARRAY[p.tag]
      ELSE
        p."ownerUserId" = t."userId" AND marker.tags = ARRAY[p.tag]
      END
    )
    WHERE ${selected} ${period(Prisma.sql`t`, filters)}
`;
}

/** Unknown single tags and excluded merchant history must not masquerade as complete history. */
export function reportUnattributedSource(
  scope: PlatformScope,
  filters: Period,
) {
  const owners = [...new Set(scope.map((p) => p.ownerUserId))];
  const tags = scope.map((p) => p.tag);
  return Prisma.sql`SELECT count(*) AS count FROM "Transaction" t
    WHERE (${owners.length ? Prisma.sql`t."userId" IN (${Prisma.join(owners)})` : Prisma.sql`false`}
      OR (${tags.length ? Prisma.sql`${reportMarkerTags()} && ARRAY[${Prisma.join(tags)}]::text[]` : Prisma.sql`false`}
        AND NOT (coalesce(t.tracking, '{}'::jsonb) ? 'reportAttribution')
        AND EXISTS (SELECT 1 FROM "IntegrationMerchant" m JOIN "Platform" p ON ${scope.length ? Prisma.sql`p.id IN (${Prisma.join(scope.map((p) => p.id))})` : Prisma.sql`false`}
          WHERE m."userId" = t."userId" AND (m."integrationKey" = 'platform:' || p.id OR EXISTS (
            SELECT 1 FROM "PlatformIntegration" i WHERE i."platformId" = p.id AND i.key = 'LEGACY_MERCHANT_KEYS'
              AND m."integrationKey" = ANY(regexp_split_to_array(i.url, '\\s*,\\s*'))
          )))
      ))
      ${period(Prisma.sql`t`, filters)}
      AND NOT EXISTS (SELECT 1 FROM (${ownedReportSource(scope, filters)}) included WHERE included.id = t.id)
      AND NOT EXISTS (SELECT 1 FROM "Platform" other WHERE other."ownerUserId" = t."userId"
        AND ${reportMarkerTags()} = ARRAY[other.tag]
        AND ${scope.length ? Prisma.sql`other.id NOT IN (${Prisma.join(scope.map((p) => p.id))})` : Prisma.sql`false`})`;
}
