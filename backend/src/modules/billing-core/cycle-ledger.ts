import { ConflictException } from '@nestjs/common';
import { coproductionKeyFor } from '../offer/offer-coproduction';
import { Prisma, type Charge, type Offer } from '@prisma/client';
import {
  captureCoproduction,
  withCoproduction,
} from '../coproduction/coproduction.service';
import {
  cyclePolicyTag,
  defaultCycleMethod,
  frozenQuoteFrom,
  loadCyclePolicyContext,
  quoteOfferCycle,
} from './cycle-pricing';
import { settleFinalNet } from '../platform-core/link-settlement';
import { transactionPlatformTagData } from '../platform-core/transaction-platform';

export type CyclePaymentDetails = {
  method?: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';
  /** Acquirer-side id of the payment, when the executor or webhook knows it. */
  externalPaymentId?: string;
  /** The Transaction for this charge already exists (first checkout charge): only advance the contract. */
  alreadyBooked?: boolean;
};

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
  const frozen = frozenQuoteFrom(charge);
  const method =
    details.method ??
    charge.method ??
    frozen?.method ??
    defaultCycleMethod(offer);
  const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
  const policyTag = cyclePolicyTag(offer);
  // Book from the quote frozen at claim time. Re-quote only for legacy charges without one (or
  // when the paying method differs), over the original base and never over the buyer total.
  const quote =
    frozen && frozen.method === method
      ? frozen
      : quoteOfferCycle(
          await loadCyclePolicyContext(tx, offer),
          {
            ...offer,
            amountCents: frozen?.baseAmountCents ?? charge.amountCents,
          },
          method,
          1,
        );
  if (!quote.financialSnapshot && !frozen)
    throw new ConflictException(
      'Política financeira sem faixa para o meio de pagamento do ciclo',
    );
  const key = coproductionKeyFor(offer);
  const coproduction = await captureCoproduction(
    tx,
    key.product,
    key.productId,
    charge.ownerUserId,
    offer.platformTag ? platformTag : undefined,
  );
  const financialSnapshot = withCoproduction(
    (quote.financialSnapshot ?? null) as Prisma.InputJsonValue,
    coproduction,
  );
  const { totalFee, domFee, platformFee } = quote;
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
      platformFee: new Prisma.Decimal(platformFee),
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
        ...(charge.snapshot && typeof charge.snapshot === 'object'
          ? (charge.snapshot as Record<string, unknown>)
          : {}),
        method,
        policyTag,
        totalAmount: quote.totalAmount,
        netAmount: quote.netAmount,
        totalFee: quote.totalFee,
        domFee: quote.domFee,
        platformFee: quote.platformFee,
        financial: financialSnapshot ?? null,
        frozenAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
  return row.id;
}
