import { describe, expect, it } from 'bun:test';
import { compareLanes, deliveryLaneId } from './delivery-fee-settings';

describe('delivery fee lanes', () => {
  it('orders methods first and installments numerically', () => {
    const lanes = [
      { method: 'PIX', installments: 1 },
      { method: 'CREDIT_CARD', installments: 10 },
      { method: 'CREDIT_CARD', installments: 2 },
      { method: 'DEBIT_CARD', installments: 1 },
      { method: 'CREDIT_CARD', installments: 1 },
      { method: 'CREDIT_CARD', installments: 12 },
    ] as const;
    expect([...lanes].sort(compareLanes).map(deliveryLaneId)).toEqual([
      'CREDIT_CARD/1',
      'CREDIT_CARD/2',
      'CREDIT_CARD/10',
      'CREDIT_CARD/12',
      'DEBIT_CARD/1',
      'PIX/1',
    ]);
  });
});
