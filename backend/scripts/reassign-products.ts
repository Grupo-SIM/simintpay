/**
 * Audited product owner reassignment (plan 0009). Dry-run by default.
 *
 *   bun scripts/reassign-products.ts --mapping=mapping.json
 *   bun scripts/reassign-products.ts --apply --mapping=mapping.json --confirm-host=<db host> [--actor=<admin user id>]
 *
 * Changes ONLY the product's userId and records ProductOwnershipChange in the same transaction.
 * Transactions, order snapshots, coproduction allocations/agreements, ledger and wallets are never
 * touched: past charges keep their frozen owner, future charges read product.userId.
 * The whole mapping is applied atomically: one rejected entry rolls back everything.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  PRODUCT_TYPES,
  hostOf,
  mappingHash,
  normalizeTags,
  parseMapping,
  type MappingEntry,
  type ProductType,
} from './product-ownership';

export type EntryResult = {
  productType: ProductType;
  productId: string;
  fromUserId: string | null;
  toUserId: string;
  outcome: 'CHANGED' | 'WOULD_CHANGE' | 'SKIPPED' | 'REJECTED';
  detail?: string;
};

export class ReassignmentRejected extends Error {
  constructor(public readonly results: EntryResult[]) {
    super('Reassignment rejected; nothing was changed');
  }
}

const agreementKey: Record<ProductType, string> = {
  PaymentLink: 'links-pagamento',
  SubscriptionLink: 'links-assinatura',
  Plan: 'planos',
  PixCreditPlan: 'planos-pix',
  Boleto: 'boletos',
};
const delegate = (tx: Prisma.TransactionClient, type: ProductType) =>
  (tx as any)[type.charAt(0).toLowerCase() + type.slice(1)];

export async function reassignProducts(
  db: PrismaClient,
  entries: MappingEntry[],
  options: { apply: boolean; actor?: string },
): Promise<EntryResult[]> {
  const hash = mappingHash(entries);
  const ordered = [...entries].sort((a, b) =>
    `${a.productType}:${a.productId}`.localeCompare(
      `${b.productType}:${b.productId}`,
    ),
  );
  const run = async (tx: Prisma.TransactionClient) => {
    const actor = options.actor ?? 'SCRIPT';
    if (options.actor) {
      const admin = await tx.user.findUnique({ where: { id: options.actor } });
      if (!admin || admin.role !== 'ADMIN' || !admin.isActive || admin.isPurged)
        throw new Error('--actor must be an active ADMIN user');
    }
    const results: EntryResult[] = [];
    for (const entry of ordered) {
      const base = {
        productType: entry.productType,
        productId: entry.productId,
        toUserId: entry.newOwnerUserId,
      };
      const reject = (
        fromUserId: string | null,
        detail: string,
      ): EntryResult => ({ ...base, fromUserId, outcome: 'REJECTED', detail });
      const table = Prisma.raw(`"${entry.productType}"`);
      const lock = options.apply ? Prisma.sql`FOR UPDATE` : Prisma.empty;
      const rows = await tx.$queryRaw<
        { userId: string }[]
      >`SELECT "userId" FROM ${table} WHERE id = ${entry.productId} ${lock}`;
      if (!rows.length) {
        results.push(reject(null, 'PRODUCT_NOT_FOUND'));
        continue;
      }
      const from = rows[0].userId;
      if (from === entry.newOwnerUserId) {
        results.push({
          ...base,
          fromUserId: from,
          outcome: 'SKIPPED',
          detail: 'ALREADY_OWNED_BY_TARGET',
        });
        continue;
      }
      if (entry.expectedFromUserId && entry.expectedFromUserId !== from) {
        results.push(reject(from, 'OWNER_CHANGED_SINCE_APPROVAL'));
        continue;
      }
      const target = await tx.user.findUnique({
        where: { id: entry.newOwnerUserId },
      });
      if (
        !target ||
        target.role === 'ADMIN' ||
        !target.isActive ||
        target.isPurged
      ) {
        results.push(reject(from, 'TARGET_NOT_ELIGIBLE'));
        continue;
      }

      const [row] = await tx.$queryRaw<
        { data: any }[]
      >`SELECT to_jsonb(t) AS data FROM ${table} t WHERE id = ${entry.productId}`;
      const tags = normalizeTags(
        row.data.plataformas,
        row.data.platformTag,
        row.data.tenantTag,
      );
      const problems: string[] = [];
      for (const tag of tags) {
        const platform = await tx.platform.findUnique({ where: { tag } });
        if (!platform || !platform.isActive)
          problems.push(`PLATFORM_NOT_REGISTERED_OR_INACTIVE:${tag}`);
        else if (platform.ownerUserId !== target.id)
          problems.push(`PLATFORM_OWNER_MISMATCH:${tag}`);
      }
      const agreement = await tx.coproductionAgreement.findUnique({
        where: {
          product_productId: {
            product: agreementKey[entry.productType],
            productId: entry.productId,
          },
        },
      });
      if (agreement && agreement.mode !== 'INHERIT') {
        for (const p of (agreement.participants as {
          userId?: string;
          email?: string;
        }[]) ?? []) {
          const account = p.userId
            ? await tx.user.findUnique({ where: { id: p.userId } })
            : await tx.user.findFirst({
                where: {
                  email: { equals: String(p.email), mode: 'insensitive' },
                },
              });
          if (!account) problems.push('COPRODUCTION_PARTICIPANT_NOT_FOUND');
          else if (account.role === 'ADMIN')
            problems.push('COPRODUCTION_ADMIN_PARTICIPANT');
          else if (account.id === from || account.id === target.id)
            problems.push('COPRODUCTION_REFERENCES_OWNER');
        }
      }
      if (problems.length) {
        results.push(reject(from, [...new Set(problems)].join(' | ')));
        continue;
      }
      results.push({
        ...base,
        fromUserId: from,
        outcome: options.apply ? 'CHANGED' : 'WOULD_CHANGE',
      });
    }
    if (results.some((r) => r.outcome === 'REJECTED'))
      throw new ReassignmentRejected(results);
    if (!options.apply) return results;
    for (const [index, result] of results.entries()) {
      if (result.outcome !== 'CHANGED') continue;
      const entry = ordered[index];
      const updated = await delegate(tx, entry.productType).updateMany({
        where: { id: entry.productId, userId: result.fromUserId },
        data: { userId: entry.newOwnerUserId },
      });
      if (updated.count !== 1)
        throw new Error(
          `Concurrent change on ${entry.productType}:${entry.productId}`,
        );
      await tx.productOwnershipChange.create({
        data: {
          productType: entry.productType,
          productId: entry.productId,
          fromUserId: result.fromUserId!,
          toUserId: entry.newOwnerUserId,
          actor,
          reason: entry.reason,
          mappingHash: hash,
        },
      });
    }
    return results;
  };
  return db.$transaction(run, { timeout: 60_000 });
}

export function renderResults(results: EntryResult[]): string {
  return results
    .map(
      (r) =>
        `${r.outcome.padEnd(12)} ${r.productType.padEnd(16)} ${r.productId} ${r.fromUserId ?? '?'} -> ${r.toUserId}${r.detail ? `  ${r.detail}` : ''}`,
    )
    .join('\n');
}

if (import.meta.main) {
  const arg = (name: string) =>
    process.argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3);
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!arg('mapping')) throw new Error('--mapping=<file> is required');
  const host = hostOf(url);
  if (apply && arg('confirm-host') !== host)
    throw new Error(`--apply requires --confirm-host=${host}`);
  const entries = parseMapping(
    JSON.parse(readFileSync(arg('mapping')!, 'utf8')),
  );
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  console.log(
    `Database host: ${host} (${apply ? 'APPLY' : 'dry-run'}); mapping ${mappingHash(entries)}; product types: ${PRODUCT_TYPES.join(',')}`,
  );
  try {
    console.log(
      renderResults(
        await reassignProducts(db, entries, { apply, actor: arg('actor') }),
      ),
    );
  } catch (error) {
    if (error instanceof ReassignmentRejected) {
      console.error(renderResults(error.results));
      process.exitCode = 1;
    } else throw error;
  } finally {
    await db.$disconnect();
  }
}
