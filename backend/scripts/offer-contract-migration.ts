/**
 * Migrates legacy PAID PIX SubscriptionLinkOrder rows (no DOM subscription) into
 * BillingContract + Charge (subscription-migration-playbook.md, CENARIO A).
 * All the logic is in scripts/sql/migrate-paid-subscription-orders.sql; this is the safe runner.
 *
 *   # dry run (default): runs everything in a transaction, prints counts, ROLLS BACK
 *   bun --no-env-file scripts/offer-contract-migration.ts --database-url=postgresql://...
 *   # write
 *   bun --no-env-file scripts/offer-contract-migration.ts --database-url=... --apply --i-understand-this-writes
 *   # run the VERIFY queries (read-only); exit code 1 on any mismatch
 *   bun --no-env-file scripts/offer-contract-migration.ts --database-url=... --verify
 *
 * The database must be given with `--database-url`; `DATABASE_URL` and `.env` are never read.
 * The transaction aborts if wallet balances, BalanceLog, Transaction, CoproductionAllocation or
 * SubscriptionLinkOrder changed between its start and its end.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '@prisma/client';

export type CliOptions = {
  databaseUrl: string;
  apply: boolean;
  verify: boolean;
};

export function parseArgs(argv: string[]): CliOptions {
  let databaseUrl: string | undefined;
  argv.forEach((arg, i) => {
    if (arg.startsWith('--database-url='))
      databaseUrl = arg.slice('--database-url='.length);
    else if (arg === '--database-url') databaseUrl = argv[i + 1];
  });
  databaseUrl = databaseUrl?.trim();
  if (!databaseUrl || databaseUrl.startsWith('--'))
    throw new Error(
      'Refusing to run: pass --database-url=<url>. DATABASE_URL and .env are never used.',
    );
  const apply = argv.includes('--apply');
  const verify = argv.includes('--verify');
  if (apply && verify)
    throw new Error('--apply and --verify are mutually exclusive.');
  if (apply && !argv.includes('--i-understand-this-writes'))
    throw new Error(
      'Refusing to write: --apply also requires --i-understand-this-writes.',
    );
  return { databaseUrl, apply, verify };
}

export function describeTarget(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

const SQL_FILE = join(
  import.meta.dir,
  'sql',
  'migrate-paid-subscription-orders.sql',
);

/** Splits the SQL file on `-- @@ section:name` marker lines. */
export function loadStatements(
  sql = readFileSync(SQL_FILE, 'utf8'),
): Map<string, string> {
  const blocks = new Map<string, string>();
  let name: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (name) blocks.set(name, buffer.join('\n').trim().replace(/;$/, ''));
  };
  for (const line of sql.split('\n')) {
    const marker = line.match(/^-- @@ (\S+)\s*$/);
    if (marker) {
      flush();
      name = marker[1];
      buffer = [];
    } else if (name) buffer.push(line);
  }
  flush();
  return blocks;
}

type Reader = Prisma.TransactionClient;

export type Snapshot = {
  walletBalance: string;
  walletLocked: string;
  balanceLogs: number;
  transactions: number;
  allocations: number;
  ordersDigest: string;
  transactionsDigest: string;
};

/** Everything the migration promises not to touch. */
export async function snapshot(tx: Reader): Promise<Snapshot> {
  const [row] = await tx.$queryRawUnsafe<Snapshot[]>(`
    SELECT
      (SELECT COALESCE(sum(balance), 0) FROM "Wallet")::text AS "walletBalance",
      (SELECT COALESCE(sum("lockedBalance"), 0) FROM "Wallet")::text AS "walletLocked",
      (SELECT count(*) FROM "BalanceLog")::int AS "balanceLogs",
      (SELECT count(*) FROM "Transaction")::int AS "transactions",
      (SELECT count(*) FROM "CoproductionAllocation")::int AS "allocations",
      (SELECT md5(COALESCE(string_agg(o::text, '|' ORDER BY o.id), '')) FROM "SubscriptionLinkOrder" o) AS "ordersDigest",
      (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "Transaction" t) AS "transactionsDigest"`);
  return row;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  return (Object.keys(before) as (keyof Snapshot)[])
    .filter((k) => before[k] !== after[k])
    .map((k) => `${k}: ${before[k]} -> ${after[k]}`);
}

export type MigrationResult = {
  report: { decision: string; orders: number }[];
  contracts: number;
  charges: number;
  before: Snapshot;
};

/** Runs inside the caller's transaction. Throws if a protected table changed. */
export async function runMigration(
  tx: Reader,
  statements = loadStatements(),
): Promise<MigrationResult> {
  const sql = (name: string) => {
    const s = statements.get(name);
    if (!s) throw new Error(`SQL block ${name} not found`);
    return s;
  };
  const before = await snapshot(tx);
  await tx.$executeRawUnsafe(sql('migrate:candidates'));
  const report = await tx.$queryRawUnsafe<
    { decision: string; orders: number }[]
  >(sql('migrate:report'));
  const contracts = await tx.$executeRawUnsafe(sql('migrate:contracts'));
  const charges = await tx.$executeRawUnsafe(sql('migrate:charges'));
  const changed = diffSnapshots(before, await snapshot(tx));
  if (changed.length)
    throw new Error(
      `Protected data changed, aborting (nothing was written): ${changed.join('; ')}`,
    );
  return { report, contracts, charges, before };
}

export async function runVerify(
  tx: Reader,
  statements = loadStatements(),
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const [name, sql] of statements)
    if (name.startsWith('verify:'))
      rows.push(...(await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql)));
  return rows;
}

class DryRunRollback extends Error {
  constructor(readonly result: MigrationResult) {
    super('dry-run rollback');
  }
}

const TX_OPTIONS = {
  timeout: 120_000,
  maxWait: 15_000,
  isolationLevel: 'RepeatableRead' as const,
};

function printResult(result: MigrationResult, verb: string) {
  console.log('Orders by decision:');
  for (const r of result.report)
    console.log(`  ${r.decision.padEnd(26)} ${r.orders}`);
  console.log(
    `${verb}: ${result.contracts} contract(s), ${result.charges} charge(s).`,
  );
  console.log(
    `Protected data unchanged: wallet balance ${result.before.walletBalance}, ` +
      `locked ${result.before.walletLocked}, BalanceLog ${result.before.balanceLogs}.`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Target database: ${describeTarget(options.databaseUrl)}`);
  console.log(
    `Mode: ${options.verify ? 'VERIFY' : options.apply ? 'APPLY (writes)' : 'DRY RUN'}`,
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.databaseUrl, max: 2 }),
  });
  try {
    if (options.verify) {
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return runVerify(tx);
      }, TX_OPTIONS);
      if (rows.length) {
        console.error(`VERIFY FAILED: ${rows.length} mismatch(es)`);
        for (const r of rows)
          console.error(`  ${r.check} order=${r.order_id} ${r.detail}`);
        process.exitCode = 1;
      } else
        console.log('VERIFY OK: contracts and charges match the paid orders.');
      return;
    }
    if (options.apply) {
      const result = await prisma.$transaction(
        (tx) => runMigration(tx),
        TX_OPTIONS,
      );
      printResult(result, 'Applied');
      return;
    }
    try {
      await prisma.$transaction(async (tx) => {
        throw new DryRunRollback(await runMigration(tx));
      }, TX_OPTIONS);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
      printResult(error.result, 'Would insert');
      console.log('\nDry run: transaction rolled back, nothing was written.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.stack || error.message : error,
    );
    process.exit(1);
  });
