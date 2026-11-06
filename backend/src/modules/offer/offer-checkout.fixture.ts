import { Prisma } from '@prisma/client';
import { makeFakePrisma } from '../../application/use-cases/payment-link/charge-characterization.fixture';

/**
 * In-memory fake of the Prisma surface touched by the offer checkout, layered on the
 * link characterization fixture (transaction / wallet / ledger behave identically).
 */
export function makeOffer(over: Record<string, unknown> = {}): any {
  return {
    id: 'offer-1',
    ownerUserId: 'owner',
    platformTag: null,
    code: 'OFFER00001',
    kind: 'PAYMENT_LINK',
    name: 'Curso',
    description: null,
    amountCents: 10000,
    currency: 'BRL',
    isActive: true,
    acceptedMethods: ['PIX', 'CREDIT_CARD', 'DEBIT_CARD'],
    maxInstallments: 3,
    expiresAt: null,
    maxUses: null,
    usedCount: 0,
    renewalMode: 'NONE',
    metadata: null,
    legacyType: null,
    legacyId: null,
    ...over,
  };
}

export function makeOfferDb(
  offer: any,
  fixtureOpts: any = {},
  moreOffers: any[] = [],
) {
  const base = makeFakePrisma(fixtureOpts);
  const offers = [offer, ...moreOffers];
  const charges: any[] = [];
  const refs: any[] = [];
  const extra = {
    offer: {
      findUnique: async ({ where }: any) =>
        offers.find((o) => o.code === where.code || o.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        offers.filter(
          (o) =>
            (!where.id?.in || where.id.in.includes(o.id)) &&
            (!where.code?.in || where.code.in.includes(o.code)),
        ),
      updateMany: async ({ where, data }: any) => {
        const o = offers.find((x) => x.id === where.id);
        if (!o) return { count: 0 };
        if (where.isActive && !o.isActive) return { count: 0 };
        if (
          where.usedCount?.lt !== undefined &&
          !(o.usedCount < where.usedCount.lt)
        )
          return { count: 0 };
        if (
          where.usedCount?.gt !== undefined &&
          !(o.usedCount > where.usedCount.gt)
        )
          return { count: 0 };
        if (data.usedCount?.increment) o.usedCount += data.usedCount.increment;
        if (data.usedCount?.decrement) o.usedCount -= data.usedCount.decrement;
        return { count: 1 };
      },
    },
    charge: {
      findUnique: async ({ where, include }: any) => {
        const c = charges.find(
          (x) =>
            (where.id !== undefined && x.id === where.id) ||
            (where.transactionId !== undefined &&
              x.transactionId === where.transactionId),
        );
        if (!c) return null;
        return include?.offer
          ? { ...c, offer: offers.find((o) => o.id === c.offerId) ?? null }
          : c;
      },
      count: async ({ where }: any) =>
        charges.filter(
          (c) =>
            (!where.status || c.status === where.status) &&
            (!where.offerId || c.offerId === where.offerId) &&
            c.snapshot?.parentChargeId === where.AND?.[0]?.snapshot?.equals,
        ).length,
      create: async ({ data }: any) => {
        const row = {
          id: `charge-${charges.length + 1}`,
          status: 'PENDING',
          paidAt: null,
          ...data,
        };
        charges.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = charges.filter(
          (c) =>
            c.transactionId === where.transactionId &&
            (!where.status || c.status === where.status),
        );
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: any) => {
        const before = charges.length;
        for (let i = charges.length - 1; i >= 0; i--)
          if (charges[i].transactionId === where.transactionId)
            charges.splice(i, 1);
        return { count: before - charges.length };
      },
    },
    externalRef: {
      findUnique: async ({ where }: any) => {
        const k = where.acquirerCode_kind_externalId;
        if (k)
          return (
            refs.find(
              (r) =>
                r.acquirerCode === k.acquirerCode &&
                r.kind === k.kind &&
                r.externalId === k.externalId,
            ) ?? null
          );
        const e = where.entityType_entityId_acquirerCode_kind;
        return (
          refs.find(
            (r) =>
              r.entityType === e.entityType &&
              r.entityId === e.entityId &&
              r.acquirerCode === e.acquirerCode &&
              r.kind === e.kind,
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        refs.push(data);
        return data;
      },
    },
  };
  let lock: Promise<unknown> = Promise.resolve();
  const prisma: any = {
    ...base.prisma,
    ...extra,
    // The base fake snapshots/restores rows on error, so overlapping transactions would
    // clobber each other. Serialize them (a real database isolates them itself).
    $transaction: (fn: any) => {
      const run = lock.then(() =>
        base.prisma.$transaction((p: any) => fn({ ...p, ...extra })),
      );
      lock = run.catch(() => undefined);
      return run;
    },
  };
  return { prisma, base, offers, charges, refs, extra };
}

export const money = (v: any) => Number(new Prisma.Decimal(v).toString());
