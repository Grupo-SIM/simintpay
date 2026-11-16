import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';

// The consistency guard (migration 20261101090000) rejects any Wallet/BalanceLog state that differs
// from the ledger. Suites share one COPRODUCTION database, so each suite sets the guard state it
// needs in beforeAll instead of relying on suite order: suites that create drift on purpose remove it,
// suites that exercise guarded writers install it.
export const removeWalletConsistencyGuard = async (pg: Client) => {
  await pg.query(`
    DROP TRIGGER IF EXISTS wallet_ledger_consistency ON "Wallet";
    DROP TRIGGER IF EXISTS balance_log_wallet_consistency ON "BalanceLog";
    DROP FUNCTION IF EXISTS wallet_check_final_consistency();
    DROP FUNCTION IF EXISTS wallet_assert_ledger_consistency(text);
  `);
};

// Installs the migration without its one-time certification of existing rows: a shared test database
// may hold drift left by other suites, and only wallets written afterwards are checked.
export const installWalletConsistencyGuard = async (pg: Client) => {
  const installed = await pg.query(
    `SELECT to_regprocedure('wallet_assert_ledger_consistency(text)') AS guard`,
  );
  if (installed.rows[0].guard) return;
  const sql = readFileSync(
    resolve(
      import.meta.dir,
      '../prisma/migrations/20261101090000_wallet_consistency_guard/migration.sql',
    ),
    'utf8',
  ).replace(/DO \$\$[\s\S]*?\$\$;\n/, '');
  await pg.query(sql);
};
