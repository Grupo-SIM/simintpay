import type { Prisma, Transaction } from '@prisma/client';
import { domCashbackGrantCents } from '../platform-taxas/platform-taxas.store';

/**
 * Compras aprovadas em outras adquirentes recebem o cashback avulso da DOM. A DOM já concede
 * o cashback das próprias transações. Dentro da liquidação só se grava a intenção (idempotente
 * por transação); o envio HTTP acontece depois do commit, em `CashbackGrantService`.
 */
export async function enqueueCashbackGrant(
  p: Prisma.TransactionClient,
  row: Pick<Transaction, 'id' | 'acquirer'>,
) {
  if (row.acquirer === 'DOM') return;
  const valueCents = domCashbackGrantCents();
  if (valueCents <= 0) return;
  await p.cashbackGrant.upsert({
    where: { transactionId: row.id },
    update: {},
    create: { transactionId: row.id, valueCents },
  });
}
