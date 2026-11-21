import { settleCoproduction } from '../coproduction/coproduction-settlement';
import { coproductionOwnerNet } from '../coproduction/coproduction';
import { AffiliateCommissionService } from '../../application/services/affiliate-commission.service';
import { enqueueCashbackGrant } from './cashback-grant';
import { applyWalletEntry } from '../wallet-ledger/wallet-ledger';
import {
  ebookOrderCreditMetadata,
  ebookOrderFromDescription,
  fundEbookCommission,
} from './ebook-commission-funding';
import { canonicalTransactionPlatformTag } from './transaction-platform';
import { ConflictException } from '@nestjs/common';
import { Prisma, TransactionStatus, type Transaction } from '@prisma/client';

/** Caller owns the transaction. Status CAS, wallet and audit either all commit or all roll back. */
export async function settleFinalNet(
  p: Prisma.TransactionClient,
  row: Transaction,
  status: TransactionStatus,
  source: string,
): Promise<boolean> {
  const from = row.status;
  const allowed: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
    DRAFT: ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'],
    PENDING: ['COMPLETED', 'FAILED', 'EXPIRED'],
    COMPLETED: ['REFUNDED', 'CHARGEBACK', 'IN_MEDIATION'],
    IN_MEDIATION: ['COMPLETED', 'REFUNDED', 'CHARGEBACK'],
  };
  if (!allowed[from]?.includes(status)) return false;
  if (row.settlementBasis !== 'FINAL_NET' || row.netAmount == null)
    throw new ConflictException('Snapshot final ausente');
  const claimed = await p.transaction.updateMany({
    where: { id: row.id, status: from },
    data: { status, previousStatus: from },
  });
  if (claimed.count !== 1) return false;
  // Ebook orders: credits carry the platform attribution and the order marker that funds affiliate commissions.
  const ebookOrder =
    canonicalTransactionPlatformTag(row.platformTag) === 'EBOOK'
      ? ebookOrderFromDescription(row.description)
      : null;
  const ebookTag =
    canonicalTransactionPlatformTag(row.platformTag) === 'EBOOK'
      ? 'EBOOK'
      : undefined;
  const marker =
    ebookOrder && status === 'COMPLETED' && from !== 'IN_MEDIATION'
      ? ebookOrderCreditMetadata({
          orderNumber: ebookOrder,
          baseCents: Math.round(Number(row.amount) * 100),
          paidCents: Math.round(Number(row.amount) * 100),
        })
      : undefined;
  const distributed = await settleCoproduction(p, row, status, source, marker);
  let balance = new Prisma.Decimal(0),
    locked = new Prisma.Decimal(0);
  // Affiliate-only sales pay the owner here: the net minus the commission.
  let value = coproductionOwnerNet(row.financialSnapshot, row.netAmount);
  // Reversal follows the committed credit, even if configuration changed afterwards.
  if (from === 'COMPLETED' || from === 'IN_MEDIATION') {
    const credit = await p.balanceLog.findFirst({
      where: { transactionId: row.id, action: 'LINK_SETTLEMENT_COMPLETED' },
      orderBy: { createdAt: 'asc' },
    });
    if (credit) value = new Prisma.Decimal(credit.balanceDelta);
  }
  if (status === 'COMPLETED') {
    balance = value;
    if (from === 'IN_MEDIATION') locked = value.neg();
  } else if (status === 'IN_MEDIATION') {
    balance = value.neg();
    locked = value;
  } else if (status === 'REFUNDED' || status === 'CHARGEBACK') {
    if (from === 'IN_MEDIATION') locked = value.neg();
    else balance = value.neg();
  }
  if (!distributed && (!balance.isZero() || !locked.isZero())) {
    const wallet = await p.wallet.findUnique({
      where: { userId: row.userId },
    });
    if (!wallet) throw new ConflictException('Carteira ausente');
    await applyWalletEntry(p, {
      userId: row.userId,
      transactionId: row.id,
      action: `LINK_SETTLEMENT_${status}`,
      balanceDelta: balance,
      lockedDelta: locked,
      source,
      ...(ebookTag ? { platformTag: ebookTag, nature: 'SALE' as const } : {}),
      ...(marker ? { metadata: marker } : {}),
    });
  }
  if (marker && ebookOrder) await fundEbookCommission(p, ebookOrder);
  const commissions = new AffiliateCommissionService();
  if (status === 'COMPLETED' && from !== 'IN_MEDIATION')
    await enqueueCashbackGrant(p, row);
  if (status === 'COMPLETED')
    await commissions.applyForTransaction(p, {
      transactionId: row.id,
      referredUserId: row.userId,
      platformFee: row.platformFee,
    });
  else if (status === 'REFUNDED' || status === 'CHARGEBACK')
    await commissions.reverseForTransaction(p, row.id);
  await p.transactionStatusHistory.create({
    data: {
      transactionId: row.id,
      fromStatus: from,
      toStatus: status,
      metadata: { source },
    },
  });
  return true;
}

type LinkRef = { offerId?: string | null };

/** Same product on both sides (`Offer.id` keeps the id of the old link). */
export function sameLinkOwner(a: LinkRef, b: LinkRef): boolean {
  return (a.offerId ?? null) === (b.offerId ?? null);
}

/** Unique gateway reference arbitrates response/webhook/polling races; existing ownership and snapshots are immutable. */
export async function persistLinkCharge(
  p: Prisma.TransactionClient,
  data: Prisma.TransactionUncheckedCreateInput,
  nextStatus: TransactionStatus,
  draftId?: string,
) {
  if (draftId) {
    const draft = await p.transaction.findUnique({ where: { id: draftId } });
    if (
      !draft ||
      draft.userId !== data.userId ||
      !sameLinkOwner(draft, data) ||
      (draft.domPaymentId && draft.domPaymentId !== data.domPaymentId)
    )
      throw new ConflictException('Cobrança incompatível');
    await bindLinkPayment(p, draft, String(data.domPaymentId));
    if (data.pixExpire)
      await p.transaction.updateMany({
        where: { id: draft.id, pixExpire: null },
        data: { pixExpire: data.pixExpire },
      });
    if (data.pixContent)
      await p.transaction.updateMany({
        where: { id: draft.id, pixContent: null },
        data: { pixContent: data.pixContent },
      });
    await settleFinalNet(p, draft, nextStatus, 'CHARGE_PAYMENT_LINK');
    return draft;
  }
  const row = await p.transaction.upsert({
    where: { domPaymentId: String(data.domPaymentId) },
    update: {},
    create: { ...data, status: 'PENDING', settlementBasis: 'FINAL_NET' },
  });
  if (row.userId !== data.userId || !sameLinkOwner(row, data))
    throw new ConflictException(
      'Referência de pagamento pertence a outra cobrança',
    );
  if (row.settlementBasis === 'FINAL_NET')
    await settleFinalNet(p, row, nextStatus, 'CHARGE_PAYMENT_LINK');
  // Legacy rows may already have been settled by a webhook. Never rewrite or recredit them.
  return row;
}

export function linkChargeReference(
  description?: string | null,
): string | null {
  return (
    /\[LINK_CHARGE:([a-f0-9-]{36})\]/i.exec(description ?? '')?.[1] ?? null
  );
}

export async function bindLinkPayment(
  p: Prisma.TransactionClient,
  row: Transaction,
  paymentId: string,
) {
  if (row.settlementBasis !== 'FINAL_NET')
    throw new ConflictException('Cobrança incompatível');
  if (row.domPaymentId === paymentId) return;
  if (row.domPaymentId)
    throw new ConflictException('Referência de pagamento incompatível');
  const changed = await p.transaction.updateMany({
    where: { id: row.id, domPaymentId: null },
    data: { domPaymentId: paymentId },
  });
  if (!changed.count) {
    const current = await p.transaction.findUnique({ where: { id: row.id } });
    if (current?.domPaymentId !== paymentId)
      throw new ConflictException('Referência de pagamento incompatível');
  }
}

/** Historical refunds use committed audit amounts when available; older unlogged rows keep their characterized fallback. */
export async function creditedSettlementAmount(
  p: Prisma.TransactionClient,
  transactionId: string,
  fallback: Prisma.Decimal,
) {
  const credit = await p.balanceLog.findFirst({
    where: {
      transactionId,
      OR: [
        {
          action: {
            in: [
              'DOM_WEBHOOK_COMPLETED',
              'CHARGE_APPROVED_COMPLETED',
              'LINK_SETTLEMENT_COMPLETED',
            ],
          },
        },
        {
          action: { startsWith: 'WEBHOOK_' },
          metadata: { path: ['data', 'status'], equals: 'paid' },
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  return credit ? new Prisma.Decimal(credit.balanceDelta) : fallback;
}
