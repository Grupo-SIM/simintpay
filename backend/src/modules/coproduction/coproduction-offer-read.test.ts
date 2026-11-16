import { afterEach, describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import {
  canonicalProduct,
  productOwnerColumn,
  productTables,
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
const ON = { OFFER_PLATFORM_READS: '1' };

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

describe('coproduction reads through Offer (OFFER_PLATFORM_READS)', () => {
  afterEach(() => {
    delete process.env.OFFER_PLATFORM_READS;
  });

  test('default keeps the legacy product keys and tables', () => {
    for (const product of legacy) {
      expect(canonicalProduct(product, {})).toBe(product);
      expect(productTables[product]).not.toBe('Offer');
    }
  });

  test('flag on resolves every legacy key to ofertas and leaves platforms alone', () => {
    for (const product of legacy)
      expect(canonicalProduct(product, ON)).toBe('ofertas');
    expect(canonicalProduct('plataformas', ON)).toBe('plataformas');
    expect(canonicalProduct('ofertas', ON)).toBe('ofertas');
    expect(productOwnerColumn('ofertas')).toBe('ownerUserId');
    expect(productTagSql('ofertas')).toBe('p."platformTag"');
  });

  test('flag on: the listing SQL of a legacy key equals the one of the offer (table, owner, tag, agreement key)', async () => {
    const offer = recorder();
    await sharedProductIds(offer.db, 'ofertas', 'u');
    const expected = offer.queries[0];
    for (const product of legacy) {
      process.env.OFFER_PLATFORM_READS = '1';
      const flagged = recorder();
      await sharedProductIds(flagged.db, product as Product, 'u');
      expect(flagged.queries[0].sql).toBe(expected.sql);
      expect(flagged.queries[0].values).toEqual(expected.values);
      expect(flagged.queries[0].sql).toContain('"Offer"');
      delete process.env.OFFER_PLATFORM_READS;
      const plain = recorder();
      await sharedProductIds(plain.db, product as Product, 'u');
      expect(plain.queries[0].sql).toContain(`"${productTables[product]}"`);
      expect(plain.queries[0].sql).not.toContain('"Offer"');
    }
  });

  test('flag on: info lookup keys the agreement by ofertas', async () => {
    process.env.OFFER_PLATFORM_READS = '1';
    const r = recorder();
    await coproductionInfo(r.db, 'links-pagamento', 'u', [
      { id: 'p1', userId: 'seller' },
    ]);
    expect(r.queries[0].values).toContain('ofertas');
    expect(r.queries[0].values).not.toContain('links-pagamento');
  });
});
