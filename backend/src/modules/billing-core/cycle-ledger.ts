import { ConflictException } from '@nestjs/common';
import { Prisma, type Charge, type Offer } from '@prisma/client';
import {
  captureCoproduction,
  withCoproduction,
} from '../coproduction/coproduction.service';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../financial-policy/financial-charge';
import { settleFinalNet } from '../platform-core/link-settlement';
import { transactionPlatformTagData } from '../platform-core/transaction-platform';
import { buildUserTaxaTag } from '../platform-taxas/platform-taxas.store';

export type CyclePaymentDetails = {
  method?: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';
  /** Acquirer-side id of the payment, when the executor or webhook knows it. */
  externalPaymentId?: string;
  /** The Transaction for this charge already exists (first checkout charge): only advance the contract. */
  alreadyBooked?: boolean;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Books a paid contract cycle in the single existing ledger: quotes fees with the financial
 * policy, freezes fees and coproduction in the Charge snapshot, creates the Transaction and
 * credits the wallet through the same FINAL_NET settlement the link flows use. The caller owns
 * the database transaction and must only call this once per charge (after claiming it PENDING->PAID).
 * Throws when the financial policy has no lane for the method: the claim then rolls back and the
 * charge stays PENDING, so the reconciler can retry once the policy is fixed.
 */
export async function recordCyclePayment(
  tx: Prisma.TransactionClient,
  charge: Charge,
  offer: Offer,
  details: CyclePaymentDetails = {},
): Promise<string> {
  const method =
    details.method ??
    charge.method ??
    (offer.renewalMode === 'AUTO_CHARGE'
      ? 'CREDIT_CARD'
      : (offer.acceptedMethods[0] ?? 'PIX'));
  const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
  const policyTag = ['GLOBAL', 'SIMINTPAY'].includes(platformTag)
    ? buildUserTaxaTag(charge.ownerUserId)
    : platformTag;
  const quote = quoteFinancialCharge(
    await loadChargePolicy(tx, policyTag),
    charge.amountCents / 100,
    method,
  );
  if (!quote)
    throw new ConflictException(
      'Política financeira sem faixa para o meio de pagamento do ciclo',
    );
  const coproduction = await captureCoproduction(
    tx,
    'ofertas',
    offer.id,
    charge.ownerUserId,
    offer.platformTag ? platformTag : undefined,
  );
  const financialSnapshot = withCoproduction(
    quote.financialSnapshot as unknown as Prisma.InputJsonValue,
    coproduction,
  );
  const totalFee = round2(quote.totalAmount - quote.netAmount);
  const domFee = round2(quote.domFeeAmount);
  await tx.wallet.upsert({
    where: { userId: charge.ownerUserId },
    update: {},
    create: { userId: charge.ownerUserId, balance: 0 },
  });
  const row = await tx.transaction.create({
    data: {
      userId: charge.ownerUserId,
      amount: new Prisma.Decimal(quote.totalAmount),
      netAmount: new Prisma.Decimal(quote.netAmount),
      totalFee: new Prisma.Decimal(totalFee),
      domFee: new Prisma.Decimal(domFee),
      platformFee: new Prisma.Decimal(round2(totalFee - domFee)),
      paymentMethod: method,
      status: 'PENDING',
      settlementBasis: 'FINAL_NET',
      financialSnapshot,
      description: `${offer.name} [CYCLE:${charge.id}]`,
      customerName: charge.customerName,
      customerEmail: charge.customerEmail,
      customerDocument: charge.customerDocument,
      externalPaymentId: details.externalPaymentId ?? null,
      ...transactionPlatformTagData(platformTag),
    },
  });
  await settleFinalNet(tx, row, 'COMPLETED', 'BILLING_CYCLE');
  await tx.charge.update({
    where: { id: charge.id },
    data: {
      transactionId: row.id,
      method,
      snapshot: {
        method,
        policyTag,
        financial: financialSnapshot ?? null,
        frozenAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
  return row.id;
}
