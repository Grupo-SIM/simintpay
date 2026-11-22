/**
 * Script: backfill-dom-acquirer-fee.ts
 *
 * Alinha `Transaction.acquirerFee` ao custo real cobrado pela DOM (`fee_details.amount` de
 * `GET /transactions/{id}`), para transações DOM concluídas, estornadas ou com chargeback.
 * A DOM é a fonte da verdade: valores zerados ou divergentes são sobrescritos.
 *
 * Não toca em linhas cujo snapshot financeiro já tem `acquirerCost.realizedCents` (esse valor
 * prevalece em `acquirerCostReais`) e ignora cashback (a DOM não o expõe por transação).
 *
 * Padrão é simulação (nenhuma escrita). Para gravar, passe `--apply`. Antes de gravar, o
 * script salva `{ id, previous, next }` em `--backup=<arquivo>` (padrão
 * `dom-acquirer-fee-backup-<timestamp>.json`) para permitir reversão. Cada update só vale se
 * `acquirerFee` ainda estiver com o valor lido, então reexecutar é idempotente.
 *
 * Uso (a partir de backend/):
 *   bun scripts/backfill-dom-acquirer-fee.ts              # simulação
 *   bun scripts/backfill-dom-acquirer-fee.ts --apply      # grava
 *
 * Variáveis de ambiente: DATABASE_URL, DOM_TOKEN, DOM_REAL_API_URL (opcional).
 */
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

const CONCURRENCY = 6;
const DEFAULT_API = 'https://apiv3.dompagamentos.com.br/checkout/production';

const apply = process.argv.includes('--apply');
const backupArg = process.argv.find((a) => a.startsWith('--backup='));
const backupPath =
  backupArg?.slice('--backup='.length) ??
  `dom-acquirer-fee-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL não configurado');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

type Change = { id: string; previous: string; next: string };

async function domFee(
  api: string,
  token: string,
  paymentId: string,
): Promise<number | 'unavailable'> {
  try {
    const res = await fetch(`${api}/transactions/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(40_000),
    });
    const body = (await res.json()) as {
      fee_details?: { amount?: unknown };
      amount?: unknown;
    };
    if (typeof body.amount !== 'number') return 'unavailable';
    const fee = Number(body.fee_details?.amount);
    return Number.isFinite(fee) && fee >= 0
      ? Number(fee.toFixed(2))
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function main() {
  const token = process.env.DOM_TOKEN;
  if (!token) throw new Error('DOM_TOKEN não configurado');
  const api = process.env.DOM_REAL_API_URL ?? DEFAULT_API;

  const rows = await prisma.transaction.findMany({
    where: {
      acquirer: 'DOM',
      status: { in: ['COMPLETED', 'REFUNDED', 'CHARGEBACK'] },
      domPaymentId: { not: null },
    },
    select: {
      id: true,
      domPaymentId: true,
      acquirerFee: true,
      financialSnapshot: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const counts = {
    total: rows.length,
    hasRealizedCost: 0,
    unavailable: 0,
    unchanged: 0,
    filledFromZero: 0,
    corrected: 0,
  };
  const changes: Change[] = [];
  const queue = rows.filter((row) => {
    const snapshot = row.financialSnapshot as {
      acquirerCost?: { realizedCents?: unknown };
    } | null;
    if (typeof snapshot?.acquirerCost?.realizedCents === 'number') {
      counts.hasRealizedCost++;
      return false;
    }
    return true;
  });

  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < queue.length) {
        const row = queue[cursor++];
        const fee = await domFee(api, token, row.domPaymentId!);
        if (fee === 'unavailable') {
          counts.unavailable++;
          continue;
        }
        const previous = Number(row.acquirerFee);
        if (Math.abs(previous - fee) < 0.005) {
          counts.unchanged++;
          continue;
        }
        if (previous === 0) counts.filledFromZero++;
        else counts.corrected++;
        changes.push({
          id: row.id,
          previous: previous.toFixed(2),
          next: fee.toFixed(2),
        });
      }
    }),
  );

  console.log(
    JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...counts }, null, 2),
  );
  const delta = changes.reduce(
    (sum, c) => sum + Number(c.next) - Number(c.previous),
    0,
  );
  console.log(
    `Linhas a alterar: ${changes.length} (delta total R$ ${delta.toFixed(2)})`,
  );

  if (!apply) {
    console.log('Simulação: nada foi gravado. Use --apply para gravar.');
    return;
  }

  writeFileSync(backupPath, JSON.stringify(changes, null, 2));
  console.log(`Backup salvo em ${backupPath}`);

  let written = 0;
  let skipped = 0;
  for (const change of changes) {
    const result = await prisma.transaction.updateMany({
      where: {
        id: change.id,
        acquirerFee: new Prisma.Decimal(change.previous),
      },
      data: { acquirerFee: new Prisma.Decimal(change.next) },
    });
    if (result.count === 1) written++;
    else skipped++;
  }
  console.log(
    `Gravadas: ${written}. Ignoradas (alteradas por terceiros): ${skipped}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
