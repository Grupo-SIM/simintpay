import { describe, expect, test } from 'bun:test';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListOffersQueryDto } from './offer.dto';
import {
  buildOfferListOrder,
  buildOfferListWhere,
  offerListPaging,
} from './offer-list';
import { OfferService } from './offer.service';

const fields = { usedCount: 'F_USED', maxUses: 'F_MAX' } as never;
const now = new Date('2026-11-06T12:00:00Z');
const where = (query: ListOffersQueryDto, owner: string | undefined = 'u1') =>
  buildOfferListWhere({ ownerUserId: owner }, query, fields, now);

const parse = async (raw: Record<string, unknown>) => {
  const dto = plainToInstance(ListOffersQueryDto, raw);
  return {
    dto,
    errors: await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  };
};

describe('buildOfferListWhere', () => {
  test('always carries the owner scope and no filters by default', () => {
    expect(where({})).toEqual({
      ownerUserId: 'u1',
      platformTag: undefined,
      renewalMode: undefined,
      acceptedMethods: undefined,
    });
  });

  test('maps search, platform, method and recurrence', () => {
    const w = where({
      search: ' mentoria ',
      platformTag: 'global',
      paymentMethod: 'PIX',
      renewalMode: 'MANUAL_PAY',
    });
    expect(w).toMatchObject({
      platformTag: 'global',
      renewalMode: 'MANUAL_PAY',
      acceptedMethods: { has: 'PIX' },
    });
    expect(w.AND).toEqual([
      {
        OR: [
          { name: { contains: 'mentoria', mode: 'insensitive' } },
          { code: { contains: 'mentoria', mode: 'insensitive' } },
        ],
      },
    ]);
  });

  test('status filters follow inactive > expired > exhausted > active', () => {
    expect(where({ status: 'INACTIVE' }).AND).toEqual([{ isActive: false }]);
    expect(where({ status: 'EXPIRED' }).AND).toEqual([
      { isActive: true, expiresAt: { lte: now } },
    ]);
    const exhausted = {
      maxUses: { not: null },
      usedCount: { gte: 'F_MAX' },
    };
    const notExpired = {
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    expect(where({ status: 'EXHAUSTED' }).AND).toEqual([
      { isActive: true },
      notExpired,
      exhausted,
    ]);
    expect(where({ status: 'ACTIVE' }).AND).toEqual([
      { isActive: true },
      notExpired,
      { NOT: exhausted },
    ]);
  });
});

describe('order and paging', () => {
  test('newest first by default, with a stable tiebreaker', () => {
    expect(buildOfferListOrder(undefined)).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(buildOfferListOrder('amountDesc')[0]).toEqual({
      amountCents: 'desc',
    });
  });

  test('no page params keeps the legacy full list', () => {
    expect(offerListPaging({})).toBeNull();
    expect(offerListPaging({ page: 3 })).toEqual({
      page: 3,
      pageSize: 20,
      skip: 40,
    });
    expect(offerListPaging({ pageSize: 5 })).toEqual({
      page: 1,
      pageSize: 5,
      skip: 0,
    });
  });
});

describe('ListOffersQueryDto validation', () => {
  test('accepts and coerces query-string values', async () => {
    const { dto, errors } = await parse({
      page: '2',
      pageSize: '10',
      status: 'EXHAUSTED',
      paymentMethod: 'BOLETO',
      renewalMode: 'AUTO_CHARGE',
      sort: 'name',
    });
    expect(errors).toEqual([]);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(10);
  });

  test.each([
    { status: 'DELETED' },
    { paymentMethod: 'CASH' },
    { renewalMode: 'WEEKLY' },
    { sort: 'random' },
    { page: '0' },
    { pageSize: '101' },
    { pageSize: 'abc' },
    { search: 'x'.repeat(121) },
    { unknown: '1' },
  ])('rejects %p', async (raw) => {
    expect((await parse(raw)).errors.length).toBeGreaterThan(0);
  });
});

describe('OfferService.list scoping', () => {
  function service() {
    const calls: any[] = [];
    const prisma: any = {
      offer: {
        fields: { usedCount: 'F_USED', maxUses: 'F_MAX' },
        findMany: async (args: any) => {
          calls.push(['findMany', args]);
          return [{ id: 'o1' }];
        },
        count: async (args: any) => {
          calls.push(['count', args]);
          return 41;
        },
      },
    };
    return { calls, svc: new OfferService(prisma, {} as never) };
  }

  test('clients are pinned to their own offers and cannot query others', async () => {
    const { calls, svc } = service();
    await svc.list({ id: 'u1', role: 'USER' }, {});
    expect(calls[0][1].where.ownerUserId).toBe('u1');
    await expect(
      svc.list({ id: 'u1', role: 'USER' }, { ownerUserId: 'u2' }),
    ).rejects.toThrow('Titular não autorizado');
  });

  test('admins see all or filter by owner', async () => {
    const { calls, svc } = service();
    await svc.list({ id: 'a', role: 'ADMIN' }, {});
    await svc.list({ id: 'a', role: 'ADMIN' }, { ownerUserId: 'u2' });
    expect(calls[0][1].where.ownerUserId).toBeUndefined();
    expect(calls[1][1].where.ownerUserId).toBe('u2');
  });

  test('without paging returns the plain array (backwards compatible)', async () => {
    const { svc } = service();
    expect(
      await svc.list(
        { id: 'u1', role: 'USER' },
        { renewalMode: 'AUTO_CHARGE' },
      ),
    ).toEqual([{ id: 'o1' }]);
  });

  test('with paging returns data plus meta, same where for count', async () => {
    const { calls, svc } = service();
    const result: any = await svc.list(
      { id: 'u1', role: 'USER' },
      { page: 2, pageSize: 20 },
    );
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
    expect(result.data).toEqual([{ id: 'o1' }]);
    expect(calls[0][1]).toMatchObject({ skip: 20, take: 20 });
    expect(calls[1][1].where).toEqual(calls[0][1].where);
  });
});
