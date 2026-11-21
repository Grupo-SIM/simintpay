import { expect } from 'bun:test';
import { fixture, run } from './affiliate-fixture.test';

const co = (email: string, percentageBps: number, version = 0) => ({
  basis: 'NET' as const,
  version,
  participants: [{ email, percentageBps }],
});
const savedVersion = async (
  f: Awaited<ReturnType<typeof fixture>>,
  product: 'ofertas' | 'plataformas',
  id: string,
) => (await f.copro.get(f.owner.id, product, id)).data.version;

run(
  'joint limit is symmetric: the coproduction PUT refuses what the affiliate PUT would refuse',
  async () => {
    const f = await fixture();
    await f.saveOffer({
      defaultPercentageBps: 4000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    // 40% affiliate + 60% coproducer is exactly 100%: accepted
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      co(f.aff2.email, 6000),
    );
    // 60.01% would be 100.01%: refused with the total and the excess, no third-party data
    const error = await f.copro
      .save(f.owner.id, 'ofertas', f.offer.id, co(f.aff2.email, 6001, 1))
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(400);
    const message = (error as Error).message;
    expect(message).toContain('100,01%');
    expect(message).toContain('0,01%');
    expect(message).not.toContain('@');
    expect(message).not.toContain(f.aff1.email);
    expect(message).not.toContain(f.aff2.email);
    // rollback: version and participants are untouched
    expect(await savedVersion(f, 'ofertas', f.offer.id)).toBe(1);
    expect(
      (await f.copro.get(f.owner.id, 'ofertas', f.offer.id)).data
        .participants[0].percentageBps,
    ).toBe(6000);
    // the affiliate PUT speaks the same format
    const affiliateError = await f
      .saveOffer(
        {
          defaultPercentageBps: 4001,
          affiliates: [{ email: f.aff1.email, percentageBps: null }],
        },
        1,
      )
      .catch((e: Error) => e);
    expect((affiliateError as Error).message).toContain('100,01%');
    expect((affiliateError as Error).message).toContain('0,01%');
    expect((affiliateError as Error).message).not.toContain('@');
    // lowering is always possible
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      co(f.aff2.email, 5000, 1),
    );
  },
);

run(
  'joint limit: platform affiliates count for the offer coproduction and the platform coproduction',
  async () => {
    const f = await fixture();
    await f.savePlatform({
      defaultPercentageBps: 5000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    // offer OWN coproduction: platform affiliates still add up
    await expect(
      f.copro.save(f.owner.id, 'ofertas', f.offer.id, co(f.aff2.email, 5001)),
    ).rejects.toThrow('100,01%');
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      co(f.aff2.email, 5000),
    );
    // platform coproduction (API sales): same rule
    await expect(
      f.copro.save(
        f.owner.id,
        'plataformas',
        f.platform.id,
        co(f.aff2.email, 5001),
      ),
    ).rejects.toThrow('100,01%');
    await f.copro.save(
      f.owner.id,
      'plataformas',
      f.platform.id,
      co(f.aff2.email, 5000),
    );
  },
);

run(
  'joint limit: platform coproduction is checked against inheriting offers only',
  async () => {
    const f = await fixture();
    // offer-level affiliate of 40%; the offer inherits the platform coproduction
    await f.saveOffer({
      defaultPercentageBps: 4000,
      affiliates: [{ email: f.aff1.email, percentageBps: null }],
    });
    await expect(
      f.copro.save(
        f.owner.id,
        'plataformas',
        f.platform.id,
        co(f.aff2.email, 6001),
      ),
    ).rejects.toThrow('100,01%');
    expect(await savedVersion(f, 'plataformas', f.platform.id)).toBe(0);
    await f.copro.save(
      f.owner.id,
      'plataformas',
      f.platform.id,
      co(f.aff2.email, 6000),
    );
    // an OWN offer agreement replaces the list, so the platform list no longer matters to it
    await f.copro.save(
      f.owner.id,
      'ofertas',
      f.offer.id,
      co(f.aff2.email, 1000),
    );
    await f.copro.save(
      f.owner.id,
      'plataformas',
      f.platform.id,
      co(f.aff2.email, 7000, 1),
    );
  },
);

run('joint limit counts the same person once', async () => {
  const f = await fixture();
  await f.saveOffer({
    affiliates: [{ email: f.aff1.email, percentageBps: 5000 }],
  });
  // aff1 is coproducer 6000 and affiliate 5000: one share (tie: the coproducer's), 100% total
  // with aff2; the naive sum 6000 + 5000 + 4000 would be refused
  const saved = await f.copro.save(f.owner.id, 'ofertas', f.offer.id, {
    basis: 'NET',
    version: 0,
    participants: [
      { email: f.aff1.email, percentageBps: 6000 },
      { email: f.aff2.email, percentageBps: 4000 },
    ],
  });
  expect(saved.data.version).toBe(1);
});
