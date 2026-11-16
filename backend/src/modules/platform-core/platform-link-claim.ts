import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { offerPlatformReadsEnabled } from '../offer/offer-read-flag';
import { lockWalletLedger } from '../wallet-ledger/wallet-ledger';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/**
 * Selectors of the claimable links of a platform. Legacy tables by default; with
 * `OFFER_PLATFORM_READS=1` the same ids resolve through `Offer` (`Offer.id` is the legacy id,
 * a payment link is a non-recurring offer, a subscription link a recurring one).
 */
export function claimSelectors(
  tag: string,
  paymentIds: string[],
  subscriptionIds: string[],
  onOffers = offerPlatformReadsEnabled(),
) {
  if (onOffers)
    return {
      payment: {
        id: { in: paymentIds },
        platformTag: tag,
        renewalMode: 'NONE' as const,
      },
      subscription: {
        id: { in: subscriptionIds },
        platformTag: tag,
        renewalMode: { not: 'NONE' as const },
      },
    };
  return {
    payment: { id: { in: paymentIds }, plataformas: { has: tag } },
    subscription: {
      id: { in: subscriptionIds },
      OR: [{ platformTag: tag }, { plataformas: { has: tag } }],
    },
  };
}
export type LinkClaim = {
  paymentLinkIds?: string[];
  subscriptionLinkIds?: string[];
  retroactiveAmountCents?: number;
  serviceAccountEmail?: string;
};
/** Transfers future link ownership only. Settled ledger and order ownership stay historical. */
export class PlatformLinkClaim {
  constructor(private readonly prisma: PrismaService) {}
  async claim(tag: string, targetUserId: string, body: LinkClaim) {
    if (tag !== 'AREAFLIX')
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: 'links.claim',
      });
    const cents = body.retroactiveAmountCents ?? 0;
    if (!Number.isSafeInteger(cents) || cents < 0)
      throw new BadRequestException('retroactiveAmountCents inválido');
    if (
      ![body.paymentLinkIds, body.subscriptionLinkIds].every(
        (ids) =>
          ids === undefined ||
          (Array.isArray(ids) &&
            ids.every((id) => typeof id === 'string' && id.trim())),
      )
    )
      throw new BadRequestException('IDs de links inválidos');
    const paymentIds = [...new Set(body.paymentLinkIds ?? [])];
    const subscriptionIds = [...new Set(body.subscriptionLinkIds ?? [])];
    const logId = createHash('sha256')
      .update(`platform-claim:${tag}:${targetUserId}`)
      .digest('hex');
    return this.prisma.$transaction(
      async (p) => {
        const platform = await p.platform.findUnique({
          where: { tag },
          include: { owner: true },
        });
        if (
          !platform?.isActive ||
          !platform.owner.isActive ||
          platform.owner.isPurged ||
          platform.ownerUserId !== targetUserId
        )
          throw new ForbiddenException('Vínculo exige dono atual ativo');
        const onOffers = offerPlatformReadsEnabled();
        const where = claimSelectors(
          tag,
          paymentIds,
          subscriptionIds,
          onOffers,
        );
        const [payments, subscriptions] = await Promise.all(
          onOffers
            ? [
                p.offer.findMany({
                  where: where.payment as Prisma.OfferWhereInput,
                  select: { id: true },
                }),
                p.offer.findMany({
                  where: where.subscription as Prisma.OfferWhereInput,
                  select: { id: true },
                }),
              ]
            : [
                p.paymentLink.findMany({
                  where: where.payment as Prisma.PaymentLinkWhereInput,
                  select: { id: true },
                }),
                p.subscriptionLink.findMany({
                  where:
                    where.subscription as Prisma.SubscriptionLinkWhereInput,
                  select: { id: true },
                }),
              ],
        );
        if (
          payments.length !== paymentIds.length ||
          subscriptions.length !== subscriptionIds.length
        )
          throw new UnprocessableEntityException({
            code: 'LINK_PLATFORM_BINDING_MISSING',
          });
        let transferred = 0;
        if (
          cents > 0 &&
          !(await p.balanceLog.findFirst({
            where: { userId: targetUserId, action: 'AREAFLIX_CLAIM_TRANSFER' },
          }))
        ) {
          const binding = await p.platformIntegration.findUnique({
            where: {
              platformId_key: {
                platformId: platform.id,
                key: 'CLAIM_SOURCE_USER_ID',
              },
            },
          });
          if (!binding?.url)
            throw new UnprocessableEntityException({
              code: 'CLAIM_SOURCE_BINDING_MISSING',
            });
          const source = await p.user.findUnique({
            where: { id: binding.url },
            include: { wallet: true },
          });
          if (
            !source?.isActive ||
            source.isPurged ||
            !source.wallet ||
            source.id === targetUserId ||
            (body.serviceAccountEmail &&
              body.serviceAccountEmail.trim() !== source.email)
          )
            throw new BadRequestException('Conta de origem inválida');
          if (
            (await p.platform.count({ where: { ownerUserId: source.id } })) > 1
          )
            throw new UnprocessableEntityException({
              code: 'SHARED_WALLET_MAINTENANCE_BLOCKED',
            });
          const amount = new Prisma.Decimal(cents).div(100);
          await p.wallet.upsert({
            where: { userId: targetUserId },
            update: {},
            create: { userId: targetUserId, balance: 0, lockedBalance: 0 },
          });
          // Both ledgers are locked in a stable order (no deadlock between opposite claims) before
          // the source balance used for the decision is read; the logs then move the wallets.
          for (const id of [source.id, targetUserId].sort())
            await lockWalletLedger(p, id);
          const sourceWallet = await p.wallet.findUniqueOrThrow({
            where: { userId: source.id },
          });
          if (sourceWallet.balance.minus(sourceWallet.lockedBalance).lt(amount))
            throw new BadRequestException('Saldo de origem insuficiente');
          for (const [userId, delta, id] of [
            [source.id, amount.neg(), `${logId}-source`],
            [targetUserId, amount, logId],
          ] as const) {
            await p.balanceLog.create({
              data: {
                id,
                userId,
                action: 'AREAFLIX_CLAIM_TRANSFER',
                balanceDelta: delta,
                lockedDelta: 0,
                source: tag,
                description:
                  'Transferência por vínculo explícito de plataforma',
              },
            });
          }
          transferred = amount.toNumber();
        }
        const notOwner = { not: targetUserId };
        const [paymentsResult, subscriptionsResult] = onOffers
          ? [
              await p.offer.updateMany({
                where: {
                  ...(where.payment as Prisma.OfferWhereInput),
                  ownerUserId: notOwner,
                },
                data: { ownerUserId: targetUserId },
              }),
              await p.offer.updateMany({
                where: {
                  ...(where.subscription as Prisma.OfferWhereInput),
                  ownerUserId: notOwner,
                },
                data: { ownerUserId: targetUserId },
              }),
            ]
          : [
              await p.paymentLink.updateMany({
                where: {
                  ...(where.payment as Prisma.PaymentLinkWhereInput),
                  userId: notOwner,
                },
                data: { userId: targetUserId },
              }),
              await p.subscriptionLink.updateMany({
                where: {
                  ...(where.subscription as Prisma.SubscriptionLinkWhereInput),
                  userId: notOwner,
                },
                data: { userId: targetUserId },
              }),
            ];
        return {
          claimed: true,
          targetUserId,
          transferred: {
            paymentLinks: paymentsResult.count,
            subscriptionLinks: subscriptionsResult.count,
            orders: 0,
            transactions: 0,
          },
          retroactiveTransferred: transferred,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
