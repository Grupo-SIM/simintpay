import type { Prisma } from '@prisma/client';
import {
  OFFER_LIST_DEFAULT_PAGE_SIZE,
  type ListOffersQueryDto,
} from './offer.dto';

type FieldRefs = {
  usedCount: Prisma.IntFieldRefInput<'Offer'>;
  maxUses: Prisma.IntFieldRefInput<'Offer'>;
};

/** Precedência de status: desativada > vencida > esgotada > ativa (igual ao badge do dashboard). */
export function buildOfferListWhere(
  scope: { ownerUserId: string | undefined },
  query: ListOffersQueryDto,
  fields: FieldRefs,
  now = new Date(),
): Prisma.OfferWhereInput {
  const and: Prisma.OfferWhereInput[] = [];
  const search = query.search?.trim();
  if (search)
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ],
    });
  const notExpired: Prisma.OfferWhereInput = {
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  const exhausted: Prisma.OfferWhereInput = {
    maxUses: { not: null },
    usedCount: { gte: fields.maxUses },
  };
  switch (query.status) {
    case 'INACTIVE':
      and.push({ isActive: false });
      break;
    case 'EXPIRED':
      and.push({ isActive: true, expiresAt: { lte: now } });
      break;
    case 'EXHAUSTED':
      and.push({ isActive: true }, notExpired, exhausted);
      break;
    case 'ACTIVE':
      and.push({ isActive: true }, notExpired, { NOT: exhausted });
      break;
  }
  return {
    ownerUserId: scope.ownerUserId,
    kind: query.kind,
    platformTag: query.platformTag,
    renewalMode: query.renewalMode,
    acceptedMethods: query.paymentMethod
      ? { has: query.paymentMethod }
      : undefined,
    ...(and.length ? { AND: and } : {}),
  };
}

export function buildOfferListOrder(
  sort: ListOffersQueryDto['sort'],
): Prisma.OfferOrderByWithRelationInput[] {
  switch (sort) {
    case 'oldest':
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'name':
      return [{ name: 'asc' }, { id: 'asc' }];
    case 'amountAsc':
      return [{ amountCents: 'asc' }, { id: 'asc' }];
    case 'amountDesc':
      return [{ amountCents: 'desc' }, { id: 'asc' }];
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

/** null = sem paginação (lista completa, formato legado). */
export function offerListPaging(query: ListOffersQueryDto) {
  if (query.page === undefined && query.pageSize === undefined) return null;
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? OFFER_LIST_DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize };
}
