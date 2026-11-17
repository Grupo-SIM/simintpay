import { describe, expect, test } from 'bun:test';
import { OfferService } from './offer.service';

const offer = (id: string, code: string, amountCents: number) => ({
  id,
  code,
  ownerUserId: 'u1',
  name: code,
  description: null,
  amountCents,
  currency: 'BRL',
  fulfillment: null,
  updatedAt: new Date(0),
  renewalMode: 'NONE',
  isActive: true,
  expiresAt: null,
});

const offers: Record<string, ReturnType<typeof offer>> = {
  b1: offer('b1', 'B1', 2000),
  up: offer('up', 'UP', 5000),
  dn: offer('dn', 'DN', 3000),
};
for (let i = 0; i < 6; i++) offers[`x${i}`] = offer(`x${i}`, `X${i}`, 1000);

function service() {
  const prisma: any = {
    offer: {
      findMany: async ({ where }: any) =>
        Object.values(offers).filter((o) => where.id.in.includes(o.id)),
    },
  };
  return new OfferService(prisma, {} as any) as any;
}

const check = (bumps: unknown[]) =>
  service().checkFulfillment({ bumps }, 'u1', 'main');

describe('checkFulfillment funnel write rules', () => {
  test('accepts extras and keeps them in the persisted JSON', async () => {
    const out: any = await check([
      {
        offerId: 'b1',
        role: 'BUMP',
        headline: 'Leve junto',
        originalAmountCents: 4000,
      },
      { offerId: 'up', role: 'UPSELL', countdownSeconds: 300, isActive: false },
    ]);
    expect(out.bumps[0]).toEqual({
      offerId: 'b1',
      role: 'BUMP',
      headline: 'Leve junto',
      originalAmountCents: 4000,
    });
    expect(out.bumps[1]).toMatchObject({
      countdownSeconds: 300,
      isActive: false,
    });
  });

  test('legacy entries without extras stay valid', async () => {
    const out: any = await check([{ offerId: 'b1', role: 'BUMP' }]);
    expect(out.bumps).toEqual([{ offerId: 'b1', role: 'BUMP' }]);
  });

  test('original price must exceed the bump offer price', async () => {
    await expect(
      check([{ offerId: 'b1', role: 'BUMP', originalAmountCents: 2000 }]),
    ).rejects.toThrow('maior que o preço');
    await expect(
      check([{ offerId: 'b1', role: 'BUMP', originalAmountCents: 2001 }]),
    ).resolves.toBeDefined();
  });

  test('rejects extra upsell/downsell and downsell without upsell', async () => {
    await expect(
      check([
        { offerId: 'up', role: 'UPSELL' },
        { offerId: 'b1', role: 'UPSELL' },
      ]),
    ).rejects.toThrow('Máximo de 1 upsell');
    await expect(
      check([
        { offerId: 'up', role: 'UPSELL' },
        { offerId: 'dn', role: 'DOWNSELL' },
        { offerId: 'b1', role: 'DOWNSELL' },
      ]),
    ).rejects.toThrow('Máximo de 1 downsell');
    await expect(check([{ offerId: 'dn', role: 'DOWNSELL' }])).rejects.toThrow(
      'Downsell exige',
    );
  });

  test('rejects countdown on BUMP and out-of-range values', async () => {
    await expect(
      check([{ offerId: 'b1', role: 'BUMP', countdownSeconds: 60 }]),
    ).rejects.toThrow('Cronômetro');
    await expect(
      check([{ offerId: 'up', role: 'UPSELL', countdownSeconds: 10 }]),
    ).rejects.toThrow('countdownSeconds');
  });

  test('rejects more than 5 order bumps', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      offerId: `x${i}`,
      role: 'BUMP',
    }));
    await expect(check(six)).rejects.toThrow('Máximo de 5');
    await expect(check(six.slice(0, 5))).resolves.toBeDefined();
  });
});

describe('public bumps', () => {
  const parent = (bumps: unknown[]) => ({
    id: 'main',
    ownerUserId: 'u1',
    fulfillment: { bumps },
  });

  test('skips inactive entries and nulls non-discount original prices', async () => {
    const out = await (service() as any).publicBumps(
      parent([
        {
          offerId: 'b1',
          role: 'BUMP',
          headline: 'Oi',
          originalAmountCents: 1500,
        },
        {
          offerId: 'up',
          role: 'UPSELL',
          originalAmountCents: 9000,
          countdownSeconds: 120,
        },
        { offerId: 'dn', role: 'DOWNSELL', isActive: false },
      ]),
      new Date(),
    );
    expect(out.map((b: any) => b.code)).toEqual(['B1', 'UP']);
    expect(out[0]).toMatchObject({
      headline: 'Oi',
      originalAmountCents: null,
      countdownSeconds: null,
    });
    expect(out[1]).toMatchObject({
      headline: null,
      originalAmountCents: 9000,
      countdownSeconds: 120,
    });
  });

  test('a BUMP entry carrying a countdown is invalid and reads as empty', async () => {
    const out = await (service() as any).publicBumps(
      parent([{ offerId: 'b1', role: 'BUMP', countdownSeconds: 60 }]),
      new Date(),
    );
    expect(out).toEqual([]);
  });
});
