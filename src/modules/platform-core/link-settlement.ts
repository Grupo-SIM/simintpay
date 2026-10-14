import { AffiliateCommissionService } from '../../application/services/affiliate-commission.service';
import { ConflictException } from '@nestjs/common';
import { Prisma, TransactionStatus, type Transaction } from '@prisma/client';

/** Caller owns the transaction. Status CAS, wallet and audit either all commit or all roll back. */
export async function settleFinalNet(
  p: Prisma.TransactionClient, row: Transaction, status: TransactionStatus, source: string,
): Promise<boolean> {
  const from = row.status;
  const allowed: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
    DRAFT: ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'],
    PENDING: ['COMPLETED', 'FAILED', 'EXPIRED'],
    COMPLETED: ['REFUNDED', 'CHARGEBACK', 'IN_MEDIATION'],
    IN_MEDIATION: ['COMPLETED', 'REFUNDED', 'CHARGEBACK'],
  };
  if (!allowed[from]?.includes(status)) return false;
  if (row.settlementBasis !== 'FINAL_NET' || row.netAmount == null) throw new ConflictException('Snapshot final ausente');
  const claimed = await p.transaction.updateMany({ where: { id: row.id, status: from }, data: { status, previousStatus: from } });
  if (claimed.count !== 1) return false;
  let balance = new Prisma.Decimal(0), locked = new Prisma.Decimal(0);
  let value = new Prisma.Decimal(row.netAmount);
  // Reversal follows the committed credit, even if configuration changed afterwards.
  if (from === 'COMPLETED' || from === 'IN_MEDIATION') {
    const credit = await p.balanceLog.findFirst({ where: { transactionId: row.id, action: 'LINK_SETTLEMENT_COMPLETED' }, orderBy: { createdAt: 'asc' } });
    if (credit) value = new Prisma.Decimal(credit.balanceAfter).minus(credit.balanceBefore);
  }
  if (status === 'COMPLETED') { balance = value; if (from === 'IN_MEDIATION') locked = value.neg(); }
  else if (status === 'IN_MEDIATION') { balance = value.neg(); locked = value; }
  else if (status === 'REFUNDED' || status === 'CHARGEBACK') {
    if (from === 'IN_MEDIATION') locked = value.neg(); else balance = value.neg();
  }
  if (!balance.isZero() || !locked.isZero()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wallet = await p.wallet.findUnique({ where: { userId: row.userId } });
      if (!wallet) throw new ConflictException('Carteira ausente');
      const after = wallet.balance.add(balance), lockedAfter = wallet.lockedBalance.add(locked);
      const updated = await p.wallet.updateMany({ where: { id: wallet.id, version: wallet.version }, data: { balance: after, lockedBalance: lockedAfter, version: { increment: 1 } } });
      if (updated.count === 1) {
        await p.balanceLog.create({ data: { userId: row.userId, transactionId: row.id,
          action: `LINK_SETTLEMENT_${status}`, amount: balance.isZero() ? locked.abs() : balance.abs(),
          balanceBefore: wallet.balance, balanceAfter: after, lockedBefore: wallet.lockedBalance, lockedAfter, source } });
        break;
      }
      if (attempt === 2) throw new ConflictException('Conflito de carteira');
    }
  }
  const commissions = new AffiliateCommissionService();
  if (status === 'COMPLETED') await commissions.applyForTransaction(p, { transactionId: row.id, referredUserId: row.userId, platformFee: row.platformFee });
  else if (status === 'REFUNDED' || status === 'CHARGEBACK') await commissions.reverseForTransaction(p, row.id);
  await p.transactionStatusHistory.create({ data: { transactionId: row.id, fromStatus: from, toStatus: status, metadata: { source } } });
  return true;
}

/** Unique gateway reference arbitrates response/webhook/polling races; existing ownership and snapshots are immutable. */
export async function persistLinkCharge(p: Prisma.TransactionClient, data: Prisma.TransactionUncheckedCreateInput, nextStatus: TransactionStatus, draftId?: string) {
  if (draftId) {
    const draft = await p.transaction.findUnique({ where: { id: draftId } });
    if (!draft || draft.userId !== data.userId || draft.paymentLinkId !== data.paymentLinkId || (draft.domPaymentId && draft.domPaymentId !== data.domPaymentId)) throw new ConflictException('Cobrança incompatível');
    await bindLinkPayment(p, draft, String(data.domPaymentId));
    if (data.pixContent) await p.transaction.updateMany({ where: { id: draft.id, pixContent: null }, data: { pixContent: data.pixContent } });
    await settleFinalNet(p, draft, nextStatus, 'CHARGE_PAYMENT_LINK');
    return draft;
  }
  const row = await p.transaction.upsert({ where: { domPaymentId: String(data.domPaymentId) }, update: {},
    create: { ...data, status: 'PENDING', settlementBasis: 'FINAL_NET' } });
  if (row.userId !== data.userId || row.paymentLinkId !== data.paymentLinkId) throw new ConflictException('Referência de pagamento pertence a outra cobrança');
  if (row.settlementBasis === 'FINAL_NET') await settleFinalNet(p, row, nextStatus, 'CHARGE_PAYMENT_LINK');
  // Legacy rows may already have been settled by a webhook. Never rewrite or recredit them.
  return row;
}

export function linkChargeReference(description?: string | null): string | null {
  return /\[LINK_CHARGE:([a-f0-9-]{36})\]/i.exec(description ?? '')?.[1] ?? null;
}

export async function bindLinkPayment(p: Prisma.TransactionClient, row: Transaction, paymentId: string) {
  if (row.settlementBasis !== 'FINAL_NET') throw new ConflictException('Cobrança incompatível');
  if (row.domPaymentId === paymentId) return;
  if (row.domPaymentId) throw new ConflictException('Referência de pagamento incompatível');
  const changed = await p.transaction.updateMany({ where: { id: row.id, domPaymentId: null }, data: { domPaymentId: paymentId } });
  if (!changed.count) {
    const current = await p.transaction.findUnique({ where: { id: row.id } });
    if (current?.domPaymentId !== paymentId) throw new ConflictException('Referência de pagamento incompatível');
  }
}

/** Historical refunds use committed audit amounts when available; older unlogged rows keep their characterized fallback. */
export async function creditedSettlementAmount(p: Prisma.TransactionClient, transactionId: string, fallback: Prisma.Decimal) {
  const credit = await p.balanceLog.findFirst({ where: { transactionId, OR: [
    { action: { in: ['DOM_WEBHOOK_COMPLETED', 'CHARGE_APPROVED_COMPLETED', 'LINK_SETTLEMENT_COMPLETED'] } },
    { action: { startsWith: 'WEBHOOK_' }, metadata: { path: ['data', 'status'], equals: 'paid' } },
  ] }, orderBy: { createdAt: 'asc' } });
  return credit ? new Prisma.Decimal(credit.balanceAfter).minus(credit.balanceBefore) : fallback;
}
