import { ChargeStatus, TransactionStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

const TARGET: Partial<Record<TransactionStatus, ChargeStatus>> = {
  COMPLETED: ChargeStatus.PAID,
  FAILED: ChargeStatus.FAILED,
  EXPIRED: ChargeStatus.EXPIRED,
};

/**
 * Hook de liquidação: quando uma Transaction muda de status, a Charge ligada a ela
 * (se existir) acompanha. Idempotente: só sai de PENDING, então repetir o webhook
 * ou chamar depois do checkout síncrono não regride nem reescreve nada.
 * Refund/chargeback não alteram a Charge (continua PAID, o ledger é o registro).
 * Roda no mesmo client/transação de quem liquida. Retorna true se atualizou.
 */
export async function markChargeSettled(
  p: Pick<Prisma.TransactionClient, 'charge'>,
  transactionId: string,
  status: TransactionStatus,
  now = new Date(),
): Promise<boolean> {
  const next = TARGET[status];
  if (!next) return false;
  const changed = await p.charge.updateMany({
    where: { transactionId, status: ChargeStatus.PENDING },
    data: {
      status: next,
      ...(next === ChargeStatus.PAID ? { paidAt: now } : {}),
    },
  });
  return changed.count > 0;
}
