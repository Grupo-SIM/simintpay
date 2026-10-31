import { expect, test } from 'bun:test';
import {
  calcularParcela,
  FALLBACK_SIMINTPAY_COSTS,
} from './payment-link-calculation.ts';

const rates = {
  domFees: { 1: 0.02, 2: 0.04 },
  sellerFees: { 1: 0.09, 2: 0.09 },
  sellerFeeFixed: 4,
  cashbackFee: 3,
};

test('1x absorbs processing costs while retaining the 9% SimIntPay charge', () => {
  expect(FALLBACK_SIMINTPAY_COSTS[1]).toBe(9);
  expect(calcularParcela(100, 1, 9, true, rates)).toEqual({
    total: 100,
    juros: 0,
    parcela: 100,
    domFee: 2,
    liquido: 84,
  });
});

test('installments without buyer interest absorb costs', () => {
  expect(calcularParcela(100, 2, 0, true, rates)).toMatchObject({
    total: 100,
    juros: 0,
    parcela: 50,
    liquido: 84,
  });
});

test('explicit buyer interest stays separate from contracted cost', () => {
  expect(calcularParcela(100, 2, 5, true, rates)).toMatchObject({
    total: 105,
    juros: 5,
    parcela: 52.5,
    liquido: 89,
  });
});
