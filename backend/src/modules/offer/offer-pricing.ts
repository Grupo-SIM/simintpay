import type { Offer, PaymentMethod } from '@prisma/client';
import type { IUserRepository } from '../../core/repositories/user.repository.interface';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  priceOfferCycle,
  type CycleQuote,
} from '../billing-core/cycle-pricing';

export type OfferPricing = CycleQuote;

/**
 * Fee quote of one offer charge. Thin wrapper over the shared billing-core cycle pricing so the
 * first subscription charge and every later cycle use the exact same rule. The owner lookup is
 * no longer needed (the policy tag derives from the offer); the parameter stays for callers.
 */
export function priceOfferCharge(
  prisma: Pick<PrismaService, 'financialPolicyRevision'> & Record<string, any>,
  _users: Pick<IUserRepository, 'findById'>,
  offer: Offer,
  method: PaymentMethod,
  installments: number,
): Promise<OfferPricing> {
  return priceOfferCycle(prisma as never, offer, method, installments);
}
