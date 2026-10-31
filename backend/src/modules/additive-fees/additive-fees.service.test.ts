import { describe, expect, it } from 'bun:test';
import {
  listCompanyAdditiveFees,
  saveAdditiveAssociations,
  withAssociation,
} from './additive-fees.service';

const fee = {
  id: 'f1',
  name: 'Serviço',
  applicationScope: 'order' as const,
  displayMode: 'checkout_only' as const,
  percentageValue: 500,
  fixedValue: 100,
  active: true,
};

describe('additive fee associations', () => {
  it('uses overrides as effective values and falls back to the catalog', () => {
    expect(withAssociation(fee)).toMatchObject({
      associated: false,
      effectivePercentageValue: 500,
      effectiveFixedValue: 100,
    });
    expect(
      withAssociation(fee, { percentageOverride: 200, fixedOverride: null }),
    ).toMatchObject({
      associated: true,
      percentageOverride: 200,
      effectivePercentageValue: 200,
      effectiveFixedValue: 100,
    });
  });

  it('lists the whole catalog for GLOBAL as associated with no overrides', async () => {
    const tx: any = {
      additiveFee: {
        findMany: async () => [
          {
            id: 'f1',
            name: 'Serviço',
            applicationScope: 'order',
            displayMode: 'checkout_only',
            percentageBps: 500,
            fixedCents: 100,
            active: false,
          },
        ],
      },
    };
    expect(await listCompanyAdditiveFees(tx, null)).toEqual([
      {
        ...fee,
        active: false,
        associated: true,
        percentageOverride: null,
        fixedOverride: null,
        effectivePercentageValue: 500,
        effectiveFixedValue: 100,
      },
    ]);
  });

  it('removes on associated:false, clears overrides on reset, stores overrides otherwise', async () => {
    const calls: [string, any][] = [];
    const tx: any = {
      additiveFee: {
        findMany: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      },
      platformAdditiveFee: {
        deleteMany: async (a: any) => calls.push(['delete', a.where.feeId]),
        findUnique: async () => ({}),
        upsert: async (a: any) => calls.push(['upsert', a.update]),
      },
    };
    await saveAdditiveAssociations(tx, 'p', [
      { feeId: 'a', associated: false },
      { feeId: 'b', reset: true },
      { feeId: 'c', percentageOverride: 300, fixedOverride: null },
    ]);
    expect(calls).toEqual([
      ['delete', 'a'],
      ['upsert', { percentageOverride: null, fixedOverride: null }],
      ['upsert', { percentageOverride: 300, fixedOverride: null }],
    ]);
  });

  it('rejects unknown fees and out-of-range overrides', async () => {
    const tx: any = { additiveFee: { findMany: async () => [] } };
    expect(
      saveAdditiveAssociations(tx, 'p', [{ feeId: 'x' }]),
    ).rejects.toThrow();
    const ok: any = { additiveFee: { findMany: async () => [{ id: 'x' }] } };
    expect(
      saveAdditiveAssociations(ok, 'p', [
        { feeId: 'x', percentageOverride: 10_001 },
      ]),
    ).rejects.toThrow();
  });
});
