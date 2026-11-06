import { describe, expect, test } from 'bun:test';
import { findOfferByCodeOrId } from './find-offer-by-code-or-id';

const ID = '3f2b8a4e-1c5d-4e6f-8a9b-0c1d2e3f4a5b';

function fake(rows: { id: string; code: string }[]) {
  const calls: unknown[] = [];
  const prisma: any = {
    offer: {
      findUnique: async ({ where }: any) => {
        calls.push(where);
        return (
          rows.find((r) =>
            where.code ? r.code === where.code : r.id === where.id,
          ) ?? null
        );
      },
    },
  };
  return { calls, prisma };
}

describe('findOfferByCodeOrId', () => {
  test('prefers the code match', async () => {
    const { prisma, calls } = fake([
      { id: 'x', code: ID },
      { id: ID, code: 'OTHER' },
    ]);
    expect((await findOfferByCodeOrId(prisma, ID))?.id).toBe('x');
    expect(calls).toHaveLength(1);
  });

  test('falls back to id for uuid-shaped input', async () => {
    const { prisma } = fake([{ id: ID, code: 'ABC' }]);
    expect((await findOfferByCodeOrId(prisma, ID))?.code).toBe('ABC');
  });

  test('skips the id query for non-uuid input', async () => {
    const { prisma, calls } = fake([]);
    expect(await findOfferByCodeOrId(prisma, 'ABC123')).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
