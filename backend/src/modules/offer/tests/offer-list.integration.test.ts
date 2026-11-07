import { afterAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { OfferService } from '../offer.service';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Offer integration tests require a local database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});

test.skipIf(!db)(
  'real database: filters, status buckets, paging and owner isolation',
  async () => {
    const prisma = db!;
    const sfx = crypto.randomUUID().slice(0, 8);
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: { email: `${tag}-${sfx}@list.local`, password: 'x', name: tag },
      });
    const [me, other] = await Promise.all([mkUser('me'), mkUser('other')]);
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    let n = 0;
    const mk = (
      owner: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) =>
      prisma.offer.create({
        data: {
          ownerUserId: owner,
          createdByUserId: owner,
          code: `L${sfx}${n++}`.toUpperCase(),
          name,
          amountCents: 5000,
          acceptedMethods: ['PIX'],
          ...extra,
        } as never,
      });
    await mk(me.id, 'Alpha ativa');
    await mk(me.id, 'Beta inativa', { isActive: false });
    await mk(me.id, 'Gama vencida', { expiresAt: past });
    await mk(me.id, 'Delta esgotada', { maxUses: 2, usedCount: 2 });
    await mk(me.id, 'Epsilon com vaga', {
      maxUses: 2,
      usedCount: 1,
      expiresAt: future,
    });
    await mk(me.id, 'Zeta plano', {
      renewalMode: 'MANUAL_PAY',
      intervalType: 'MONTH',
      intervalCount: 1,
      platformTag: 'globalx',
      acceptedMethods: ['PIX', 'BOLETO'],
    });
    await mk(other.id, 'Alpha do outro');

    const svc = new OfferService(prisma as never, {} as never);
    const actor = { id: me.id, role: 'USER' };
    const names = async (q: object) =>
      ((await svc.list(actor, q)) as { name: string }[])
        .map((o) => o.name)
        .sort();

    expect(await names({})).toHaveLength(6);
    expect(await names({ search: 'ALPHA' })).toEqual(['Alpha ativa']);
    expect(await names({ search: `l${sfx}`.toLowerCase() })).toHaveLength(6);
    expect(await names({ status: 'INACTIVE' })).toEqual(['Beta inativa']);
    expect(await names({ status: 'EXPIRED' })).toEqual(['Gama vencida']);
    expect(await names({ status: 'EXHAUSTED' })).toEqual(['Delta esgotada']);
    expect(await names({ status: 'ACTIVE' })).toEqual([
      'Alpha ativa',
      'Epsilon com vaga',
      'Zeta plano',
    ]);
    expect(await names({ renewalMode: 'MANUAL_PAY' })).toEqual(['Zeta plano']);
    expect(await names({ renewalMode: 'NONE' })).toHaveLength(5);
    expect(await names({ paymentMethod: 'BOLETO' })).toEqual(['Zeta plano']);
    expect(await names({ platformTag: 'globalx' })).toEqual(['Zeta plano']);

    const page: any = await svc.list(actor, {
      page: 2,
      pageSize: 4,
      sort: 'name',
    });
    expect(page.meta).toEqual({
      page: 2,
      pageSize: 4,
      total: 6,
      totalPages: 2,
    });
    expect(page.data).toHaveLength(2);
    const newest: any = await svc.list(actor, { page: 1, pageSize: 1 });
    expect(newest.data[0].name).toBe('Zeta plano');

    await expect(svc.list(actor, { ownerUserId: other.id })).rejects.toThrow();
    const admin = (await svc.list(
      { id: other.id, role: 'ADMIN' },
      { search: 'alpha' },
    )) as any[];
    expect(admin.length).toBeGreaterThanOrEqual(2);
  },
);
