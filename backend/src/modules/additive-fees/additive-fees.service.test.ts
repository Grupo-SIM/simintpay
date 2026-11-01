import { describe, expect, it } from 'bun:test';
import {
  listAdditiveValues,
  replaceAdditiveValues,
  toEffectiveFees,
  validateAdditiveValues,
} from './additive-fees.service';

const value = {
  externalId: 'f1',
  name: 'Serviço',
  applicationScope: 'order' as const,
  percentageValue: 500,
  fixedValue: 100,
};

function fakeClient() {
  let rows: Record<string, unknown>[] = [];
  return {
    client: {
      platformAdditiveValue: {
        deleteMany: async () => {
          rows = [];
        },
        createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
          rows = data.map((row) => ({ ...row, createdAt: new Date() }));
        },
        findMany: async () =>
          [...rows].sort(
            (a, b) => (a.sortOrder as number) - (b.sortOrder as number),
          ),
      },
    } as never,
  };
}

describe('additive values', () => {
  it('validates and trims a replacement list', () => {
    expect(validateAdditiveValues([{ ...value, name: ' Serviço ' }])).toEqual([
      value,
    ]);
    expect(validateAdditiveValues([])).toEqual([]);
  });

  it('rejects malformed items and duplicate ids', () => {
    expect(() => validateAdditiveValues([value, value])).toThrow();
    expect(() =>
      validateAdditiveValues([{ ...value, applicationScope: 'x' }]),
    ).toThrow();
    expect(() =>
      validateAdditiveValues([{ ...value, percentageValue: 10_001 }]),
    ).toThrow();
    expect(() =>
      validateAdditiveValues([{ ...value, fixedValue: -1 }]),
    ).toThrow();
    expect(() => validateAdditiveValues('x')).toThrow();
  });

  it('replaces the whole list preserving order and clears on empty', async () => {
    const { client } = fakeClient();
    await replaceAdditiveValues(client, 'p', [
      value,
      { ...value, externalId: 'f2' },
    ]);
    expect(
      (await listAdditiveValues(client, 'p')).map((v) => v.externalId),
    ).toEqual(['f1', 'f2']);
    await replaceAdditiveValues(client, 'p', []);
    expect(await listAdditiveValues(client, 'p')).toEqual([]);
  });

  it('maps values to calculation fees', () => {
    expect(toEffectiveFees([value])).toEqual([
      {
        id: 'f1',
        name: 'Serviço',
        applicationScope: 'order',
        percentageValue: 500,
        fixedValue: 100,
      },
    ]);
  });
});
