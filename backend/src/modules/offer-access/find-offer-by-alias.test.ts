import { describe, expect, it } from 'bun:test';
import { findOfferByAlias, generatePixAliasCode } from './find-offer-by-alias';

describe('findOfferByAlias', () => {
  const offer = { id: 'o1', code: 'ABC' };
  const prisma = {
    offerCodeAlias: {
      findFirst: async ({ where }: any) =>
        where.code === 'PX-ABC123' && where.isActive
          ? { code: 'PX-ABC123', offer }
          : null,
    },
  } as never;

  it('resolves an active alias to its offer', async () => {
    expect(await findOfferByAlias(prisma, ' PX-ABC123 ')).toBe(offer as never);
  });

  it('returns null for unknown codes', async () => {
    expect(await findOfferByAlias(prisma, 'PX-NOPE')).toBeNull();
  });

  it('generates codes in the legacy PX-xxxxxx format', () => {
    expect(generatePixAliasCode()).toMatch(/^PX-[A-Z0-9]{1,6}$/);
  });
});
