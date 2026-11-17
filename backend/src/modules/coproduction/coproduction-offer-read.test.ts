import { describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import {
  canonicalProduct,
  productOwnerColumn,
  productTagSql,
  type Product,
} from './coproduction';
import { coproductionInfo, sharedProductIds } from './coproduction-view';

const legacy = [
  'links-pagamento',
  'links-assinatura',
  'boletos',
  'planos',
  'planos-pix',
] as const;

function recorder() {
  const queries: Prisma.Sql[] = [];
  return {
    queries,
    db: {
      $queryRaw: async (query: Prisma.Sql) => {
        queries.push(query);
        return [];
      },
    } as never,
  };
}

describe('coproduction reads through Offer', () => {
  test('every legacy key resolves to ofertas and leaves platforms alone', () => {
    for (const product of legacy)
      expect(canonicalProduct(product)).toBe('ofertas');
    expect(canonicalProduct('plataformas')).toBe('plataformas');
    expect(canonicalProduct('ofertas')).toBe('ofertas');
    expect(productOwnerColumn('ofertas')).toBe('ownerUserId');
    expect(productTagSql('ofertas')).toBe('p."platformTag"');
  });

  test('the listing SQL of a legacy key equals the one of the offer (table, owner, tag, agreement key)', async () => {
    const offer = recorder();
    await sharedProductIds(offer.db, 'ofertas', 'u');
    const expected = offer.queries[0];
    for (const product of legacy) {
      const r = recorder();
      await sharedProductIds(r.db, product as Product, 'u');
      expect(r.queries[0].sql).toBe(expected.sql);
      expect(r.queries[0].values).toEqual(expected.values);
      expect(r.queries[0].sql).toContain('"Offer"');
    }
  });

  test('info lookup keys the agreement by ofertas', async () => {
    const r = recorder();
    await coproductionInfo(r.db, 'links-pagamento', 'u', [
      { id: 'p1', userId: 'seller' },
    ]);
    expect(r.queries[0].values).toContain('ofertas');
    expect(r.queries[0].values).not.toContain('links-pagamento');
  });
});
