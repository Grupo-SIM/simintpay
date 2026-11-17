import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { generateOfferCode } from './offer-code';
import { intervalForFrequency } from './legacy-offer-mapper';
import { acceptedMethodList } from '../../application/helpers/accepted-payment-methods.helper';

type PlanMirror = Omit<Prisma.PlanUncheckedCreateInput, 'userId' | 'code'>;

/**
 * The platform plan import is stored as a recurring `Offer`
 * identified by the partner code (`OfferCodeAlias`-free: the partner code is the offer code).
 * Same ownership and platform conflict rule as the legacy `Plan` mirror.
 */
export async function mirrorPlanOffer(
  tx: Prisma.TransactionClient,
  tag: string,
  userId: string,
  code: string,
  data: PlanMirror,
) {
  const existing = await tx.offer.findUnique({ where: { code } });
  if (
    existing &&
    (existing.ownerUserId !== userId || existing.platformTag !== tag)
  )
    throw new ConflictException({
      code: 'PLAN_PLATFORM_CONFLICT',
      message: 'Plano sem vínculo explícito com plataforma e conta',
    });
  const interval = intervalForFrequency(String(data.type ?? ''));
  const multiplier =
    Number.isInteger(data.frequency) && Number(data.frequency) >= 1
      ? Number(data.frequency)
      : 1;
  const fields = {
    name: data.name,
    amountCents: Math.round(Number(data.price) * 100),
    isActive: data.isActive ?? true,
    acceptedMethods: acceptedMethodList(
      (data.paymentMethods as string | undefined) ?? 'CREDIT_CARD',
    ) as never,
    renewalMode: 'AUTO_CHARGE' as const,
    intervalType: interval.type,
    intervalCount: interval.count * multiplier,
    fulfillment: {
      ...(data.redirectUrl ? { redirectUrl: data.redirectUrl } : {}),
      ...(data.emailBody ? { emailBody: data.emailBody } : {}),
    },
    metadata: {
      ...(data.domPlanId ? { domPlanId: data.domPlanId } : {}),
      ...(data.webhookUrl ? { webhookUrl: data.webhookUrl } : {}),
    },
  };
  const row = existing
    ? await tx.offer.update({ where: { code }, data: fields })
    : await tx.offer.create({
        data: {
          ...fields,
          code: code || generateOfferCode(),
          ownerUserId: userId,
          createdByUserId: userId,
          platformTag: tag,
        },
      });
  return { success: true, id: row.id, created: !existing };
}
