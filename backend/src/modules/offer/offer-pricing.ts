import { Prisma, type Offer, type PaymentMethod } from '@prisma/client';
import { calculateAreaflixSellerNet } from '../../application/helpers/areaflix-fees.helper';
import { clientTaxaTagFor } from '../../application/helpers/client-rules.helper';
import {
  calculateDebitFees,
  calculatePaymentLinkFees,
  round2,
} from '../../application/use-cases/payment-link/payment-link-fees.helper';
import type { IUserRepository } from '../../core/repositories/user.repository.interface';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../financial-policy/financial-charge';
import { buildUserTaxaTag } from '../platform-taxas/platform-taxas.store';

export type OfferPricing = {
  platformTag: string;
  totalAmount: number;
  netAmount: number;
  domFee: number;
  totalFee: number;
  platformFee: number;
  financialSnapshot: Prisma.InputJsonValue | undefined;
};

/**
 * Fee quote of one offer charge: financial policy first, legacy link calculation otherwise.
 * Same rules as the one-off offer checkout (kept here as a separate copy so the subscribe
 * flow does not touch that service; fold both onto this helper when convenient).
 */
export async function priceOfferCharge(
  prisma: Pick<PrismaService, 'financialPolicyRevision'> & Record<string, any>,
  users: Pick<IUserRepository, 'findById'>,
  offer: Offer,
  method: PaymentMethod,
  installments: number,
): Promise<OfferPricing> {
  const platformTag = (offer.platformTag ?? 'GLOBAL').toUpperCase();
  const isPix = method === 'PIX';
  const isDebit = method === 'DEBIT_CARD';
  const owner = await users.findById(offer.ownerUserId);
  const generic = ['GLOBAL', 'SIMINTPAY'].includes(platformTag);
  const ownerClientTag = !generic ? null : clientTaxaTagFor(owner);
  const taxaTag =
    ownerClientTag ??
    (generic ? buildUserTaxaTag(offer.ownerUserId) : platformTag);
  const baseAmount = offer.amountCents / 100;
  const pricedLink = {
    amount: new Prisma.Decimal(baseAmount),
    isStandalone: true,
    plataformas: [platformTag],
  } as never;
  const financialQuote = quoteFinancialCharge(
    await loadChargePolicy(prisma as never, taxaTag),
    baseAmount,
    isPix ? 'PIX' : isDebit ? 'DEBIT_CARD' : 'CREDIT_CARD',
    installments,
  );
  const fees =
    financialQuote ??
    (isDebit
      ? (() => {
          const d = calculateDebitFees(pricedLink, taxaTag);
          return {
            totalAmount: d.baseAmount,
            netAmount: d.netAmount,
            domFeeAmount: d.domFeeAmount,
          };
        })()
      : calculatePaymentLinkFees(
          pricedLink,
          installments,
          taxaTag,
          isPix,
          false,
        ));
  const { totalAmount, domFeeAmount } = fees;
  let { netAmount } = fees;
  if (platformTag === 'AREAFLIX' && !financialQuote)
    netAmount = calculateAreaflixSellerNet(
      totalAmount,
      isPix ? 'PIX' : isDebit ? 'DEBIT_CARD' : 'CREDIT_CARD',
      installments,
    );
  const domFee = round2(domFeeAmount);
  const totalFee = round2(totalAmount - netAmount);
  return {
    platformTag,
    totalAmount,
    netAmount,
    domFee,
    totalFee,
    platformFee: round2(totalFee - domFee),
    financialSnapshot: financialQuote?.financialSnapshot as
      | Prisma.InputJsonValue
      | undefined,
  };
}
