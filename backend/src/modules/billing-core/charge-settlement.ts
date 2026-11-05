import { ChargeStatus, TransactionStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { advanceContractForCharge } from './contract-advance';

const TARGET: Partial<Record<TransactionStatus, ChargeStatus>> = {
  COMPLETED: ChargeStatus.PAID,
  FAILED: ChargeStatus.FAILED,
  EXPIRED: ChargeStatus.EXPIRED,
};

export type ChargeSettledEvent = {
  transactionId: string;
  /** PAID: a Charge acabou de ser paga. REFUNDED: a transação foi estornada/contestada. */
  kind: 'PAID' | 'REFUNDED';
};
type ChargeSettledListener = (event: ChargeSettledEvent) => void;
const listeners = new Set<ChargeSettledListener>();

/**
 * Registra um ouvinte de liquidação (ex.: entrega da oferta). Os ouvintes são chamados de
 * forma síncrona e não devem lançar nem bloquear: quem registra agenda o trabalho para depois
 * do commit da transação de quem liquida. Retorna a função que remove o ouvinte.
 */
export function onChargeSettled(listener: ChargeSettledListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ChargeSettledEvent) {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // um ouvinte com defeito nunca pode quebrar a liquidação
    }
  }
}

/**
 * Hook de liquidação: quando uma Transaction muda de status, a Charge ligada a ela
 * (se existir) acompanha. Idempotente: só sai de PENDING, então repetir o webhook
 * ou chamar depois do checkout síncrono não regride nem reescreve nada.
 * Refund/chargeback não alteram a Charge (continua PAID, o ledger é o registro).
 * Cobrança de contrato (assinatura): quem vence a liquidação também avança o contrato
 * (ativa, agenda o próximo ciclo ou cancela se a primeira cobrança falhou), na mesma transação.
 * Roda no mesmo client/transação de quem liquida. Retorna true se atualizou.
 */
export async function markChargeSettled(
  p: Pick<Prisma.TransactionClient, 'charge'> &
    Partial<Pick<Prisma.TransactionClient, 'billingContract' | 'offer'>>,
  transactionId: string,
  status: TransactionStatus,
  now = new Date(),
): Promise<boolean> {
  if (
    status === TransactionStatus.REFUNDED ||
    status === TransactionStatus.CHARGEBACK
  ) {
    emit({ transactionId, kind: 'REFUNDED' });
    return false;
  }
  const next = TARGET[status];
  if (!next) return false;
  const changed = await p.charge.updateMany({
    where: { transactionId, status: ChargeStatus.PENDING },
    data: {
      status: next,
      ...(next === ChargeStatus.PAID ? { paidAt: now } : {}),
    },
  });
  if (changed.count === 0) return false;
  // Fakes de teste só expõem `charge`; o client real sempre traz o contrato.
  if (p.billingContract) {
    const charge = await p.charge.findUnique({ where: { transactionId } });
    if (charge?.contractId)
      await advanceContractForCharge(
        p as Prisma.TransactionClient,
        charge,
        next === ChargeStatus.PAID ? 'PAID' : 'FAILED',
        now,
      );
  }
  if (next === ChargeStatus.PAID) emit({ transactionId, kind: 'PAID' });
  return true;
}
