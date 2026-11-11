import type { Prisma, Transaction } from '@prisma/client';
import { domCashbackGrantCents } from '../platform-taxas/platform-taxas.store';

/**
 * Compras aprovadas em outras adquirentes recebem o cashback avulso da DOM. A DOM já concede
 * o cashback das próprias transações. Dentro da liquidação só se grava a intenção (idempotente
 * por transação); o envio HTTP acontece depois do commit, em `CashbackGrantService`.
 */
export async function enqueueCashbackGrant(
  p: Prisma.TransactionClient,
  row: Pick<
    Transaction,
    'id' | 'acquirer' | 'platformTag' | 'financialSnapshot'
  >,
) {
  if (row.acquirer === 'DOM') return;
  // Escopo do cashback: a tag de política congelada na cobrança (usuário ou plataforma).
  const snapshot = row.financialSnapshot as { policyTag?: unknown } | null;
  const scope =
    typeof snapshot?.policyTag === 'string'
      ? snapshot.policyTag
      : (row.platformTag ?? 'GLOBAL');
  const valueCents = domCashbackGrantCents(scope);
  if (valueCents <= 0) return;
  await p.cashbackGrant.upsert({
    where: { transactionId: row.id },
    update: {},
    create: { transactionId: row.id, valueCents },
  });
}
