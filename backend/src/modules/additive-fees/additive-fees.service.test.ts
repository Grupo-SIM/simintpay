import { describe, expect, it } from 'bun:test';
import {
  listPlatformSurcharges,
  readAdditiveFees,
  setAdditiveFees,
  validateAdditiveTotals,
} from './additive-fees.service';

const totals = {
  order: { percentageValue: 500, fixedValue: 100 },
  product: { percentageValue: 100, fixedValue: 0 },
};

function fakeClient() {
  let row: any = null;
  return {
    platformAdditiveFees: {
      findUnique: async () => row,
      upsert: async ({ create }: any) => {
        row ??= {
          ...create,
          revision: 0,
          orderPct: 0,
          orderFixed: 0,
          productPct: 0,
          productFixed: 0,
        };
      },
      updateMany: async ({ where, data }: any) => {
        if (where.revision !== undefined && where.revision !== row.revision)
          return { count: 0 };
        row = { ...row, ...data, revision: row.revision + 1 };
        return { count: 1 };
      },
    },
  } as never;
}

describe('additive totals', () => {
  it('validates ranges', () => {
    expect(validateAdditiveTotals(totals)).toEqual(totals);
    expect(() => validateAdditiveTotals(null)).toThrow();
  });
  it('defaults to zero', async () => {
    expect((await readAdditiveFees(fakeClient(), 'p1')).revision).toBe('0');
  });
  it('guards stale writes and increments identical admin writes', async () => {
    const client = fakeClient();
    await setAdditiveFees(client, 'p1', totals, '0');
    await expect(setAdditiveFees(client, 'p1', totals, '0')).rejects.toThrow();
    await setAdditiveFees(client, 'p1', totals);
    expect((await readAdditiveFees(client, 'p1')).revision).toBe('2');
    const zero = {
      order: { percentageValue: 0, fixedValue: 0 },
      product: { percentageValue: 0, fixedValue: 0 },
    };
    await setAdditiveFees(client, 'p1', zero, '2');
    expect((await readAdditiveFees(client, 'p1')).effective).toEqual(zero);
    expect(await listPlatformSurcharges(client, 'p1')).toHaveLength(2);
  });
});
