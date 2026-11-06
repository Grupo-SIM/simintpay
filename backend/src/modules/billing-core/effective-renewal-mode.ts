import type { BillingContract, Offer, PaymentMethod } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export type EffectiveRenewalMode = 'AUTO_CHARGE' | 'MANUAL_PAY';

/** Cartão guardado vencido não é cobrado (mesma regra do cofre: vale até o fim do mês de validade). */
export function storedCardExpired(
  card: { expMonth: number; expYear: number },
  now: Date,
): boolean {
  return Date.UTC(card.expYear, card.expMonth, 1) <= now.getTime();
}

/** Existe cartão ACTIVE, não vencido, com token do adquirente do contrato. */
export async function hasUsableStoredCard(
  prisma: Pick<PrismaService, 'storedCard'>,
  contract: Pick<BillingContract, 'id' | 'acquirer'>,
  now: Date,
): Promise<boolean> {
  const card = await prisma.storedCard.findFirst({
    where: {
      contractId: contract.id,
      status: 'ACTIVE',
      tokens: { some: { acquirerCode: contract.acquirer } },
    },
    orderBy: { createdAt: 'desc' },
    select: { expMonth: true, expYear: true },
  });
  return !!card && !storedCardExpired(card, now);
}

/**
 * Modo de renovação efetivo do contrato. AUTO_CHARGE só quando a oferta é AUTO_CHARGE, o
 * adquirente do contrato sabe cobrar cartão guardado (`executor.canCharge`) e o contrato tem
 * um cartão utilizável. Qualquer outro caso (comprador migrado que pagou por PIX, cartão
 * revogado/vencido, adquirente sem cobrança de cartão guardado, sem executor) é pago pelo
 * comprador (MANUAL_PAY): CHARGE_DUE e suspensão após a carência, nunca cobrança falha à toa.
 * Recusa do cartão em contrato que TEM cartão continua AUTO_CHARGE (retry/past due/suspensão).
 */
export async function effectiveRenewalMode(
  prisma: Pick<PrismaService, 'storedCard'>,
  contract: BillingContract,
  offer: Pick<Offer, 'renewalMode'>,
  executor: { canCharge?(contract: BillingContract): boolean } | undefined,
  now: Date,
): Promise<EffectiveRenewalMode> {
  if (offer.renewalMode !== 'AUTO_CHARGE') return 'MANUAL_PAY';
  if (!executor || executor.canCharge?.(contract) === false)
    return 'MANUAL_PAY';
  return (await hasUsableStoredCard(prisma, contract, now))
    ? 'AUTO_CHARGE'
    : 'MANUAL_PAY';
}

/** Método de cobrança do ciclo pago pelo comprador: PIX quando aceito (renovação por link). */
export function buyerPaidCycleMethod(
  offer: Pick<Offer, 'acceptedMethods'>,
): PaymentMethod {
  return offer.acceptedMethods.includes('PIX')
    ? 'PIX'
    : (offer.acceptedMethods[0] ?? 'PIX');
}
