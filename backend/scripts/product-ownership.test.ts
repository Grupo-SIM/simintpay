import { expect, test } from 'bun:test';
import {
  mappingHash,
  normalizeTags,
  ownerColumn,
  parseMapping,
} from './product-ownership';

test('normalizes legacy tag fields without inventing platforms', () => {
  expect(
    normalizeTags(['zero_grau', 'ZERO-GRAU'], 'EBOOKSIM', null, ' ', 'GLOBAL'),
  ).toEqual(['EBOOK', 'ZERO-GRAU']);
});

test('mapping validation rejects incomplete and duplicate entries', () => {
  const ok = {
    productType: 'Boleto',
    productId: 'a',
    newOwnerUserId: 'u',
    reason: 'approved',
  };
  expect(parseMapping([ok])).toEqual([ok]);
  expect(() => parseMapping([ok, ok])).toThrow('Duplicate');
  expect(() => parseMapping([{ ...ok, productType: 'Wallet' }])).toThrow(
    'Invalid',
  );
  expect(() => parseMapping([{ ...ok, reason: '' }])).toThrow('Invalid');
  expect(() => parseMapping({})).toThrow('array');
});

test('mapping hash ignores order and changes with any approved field', () => {
  const a = {
    productType: 'Plan' as const,
    productId: 'a',
    newOwnerUserId: 'u',
    reason: 'r1',
  };
  const b = {
    productType: 'Boleto' as const,
    productId: 'b',
    newOwnerUserId: 'v',
    reason: 'r2',
  };
  expect(mappingHash([a, b])).toBe(mappingHash([b, a]));
  expect(mappingHash([a, b])).not.toBe(
    mappingHash([a, { ...b, newOwnerUserId: 'w' }]),
  );
});

test('accepts Offer products and reads their owner from ownerUserId', () => {
  const entry = {
    productType: 'Offer',
    productId: 'o1',
    newOwnerUserId: 'u',
    reason: 'approved',
  };
  expect(parseMapping([entry])).toEqual([entry]);
  expect(ownerColumn('Offer')).toBe('ownerUserId');
  expect(ownerColumn('PaymentLink')).toBe('userId');
});
