import { describe, expect, it } from 'bun:test';
import {
  listPlatformSurcharges,
  readAdditiveFees,
  setDeliveryTotals,
  setOverrideTotals,
  validateAdditiveTotals,
} from './additive-fees.service';

const totals = {
  order: { percentageValue: 500, fixedValue: 100 },
  product: { percentageValue: 100, fixedValue: 0 },
};

function fakeClient() {
  let row: Record<string, unknown> | null = null;
  const client = {
    platformAdditiveTotals: {
      findUnique: async () => row,
      upsert: async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        row = row
          ? { ...row, ...update }
          : {
              overrideOrderPct: null,
              overrideOrderFixed: null,
              overrideProductPct: null,
              overrideProductFixed: null,
              deliveryOrderPct: 0,
              deliveryOrderFixed: 0,
              deliveryProductPct: 0,
              deliveryProductFixed: 0,
              ...create,
            };
      },
    },
  } as never;
  return client;
}

describe('additive totals', () => {
  it('validates the shape and ranges', () => {
    expect(validateAdditiveTotals(totals)).toEqual(totals);
    for (const bad of [
      null,
      [],
      { order: totals.order },
      { ...totals, order: { percentageValue: 10_001, fixedValue: 0 } },
      { ...totals, order: { percentageValue: 1.5, fixedValue: 0 } },
      { ...totals, product: { percentageValue: 0, fixedValue: -1 } },
    ])
      expect(() => validateAdditiveTotals(bad)).toThrow();
  });

  it('reads zeros when nothing is stored', async () => {
    const view = await readAdditiveFees(fakeClient(), 'p1');
    expect(view.override).toBeNull();
    expect(view.effective).toEqual(view.delivery);
    expect(view.effective.order).toEqual({ percentageValue: 0, fixedValue: 0 });
  });

  it('effective is override ?? delivery, and Delivery pushes never touch the override', async () => {
    const client = fakeClient();
    await setDeliveryTotals(client, 'p1', totals);
    expect((await readAdditiveFees(client, 'p1')).effective).toEqual(totals);
    const override = {
      order: { percentageValue: 700, fixedValue: 0 },
      product: { percentageValue: 0, fixedValue: 25 },
    };
    await setOverrideTotals(client, 'p1', override);
    let view = await readAdditiveFees(client, 'p1');
    expect(view.override).toEqual(override);
    expect(view.effective).toEqual(override);
    expect(view.delivery).toEqual(totals);
    const next = { ...totals, order: { percentageValue: 1, fixedValue: 1 } };
    await setDeliveryTotals(client, 'p1', next);
    view = await readAdditiveFees(client, 'p1');
    expect(view.override).toEqual(override);
    expect(view.delivery).toEqual(next);
    await setOverrideTotals(client, 'p1', null);
    view = await readAdditiveFees(client, 'p1');
    expect(view.override).toBeNull();
    expect(view.effective).toEqual(next);
  });

  it('exposes the effective totals as two synthetic fees', async () => {
    const client = fakeClient();
    await setDeliveryTotals(client, 'p1', totals);
    const fees = await listPlatformSurcharges(client, 'p1');
    expect(fees.map((fee) => fee.applicationScope)).toEqual([
      'order',
      'product',
    ]);
    expect(fees[0]).toMatchObject({ percentageValue: 500, fixedValue: 100 });
  });
});
