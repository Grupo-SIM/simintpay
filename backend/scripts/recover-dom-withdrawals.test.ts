import { validateReviewed } from './recover-dom-withdrawals';

describe('DOM withdrawal recovery', () => {
  it('requires reconciled gross, net and fee', () => {
    const row = {
      userId: 'cliente-1',
      domWithdrawId: 'dom-1',
      status: 'COMPLETED',
      amount: '98.00',
      grossAmount: '100.00',
      fee: '2.00',
      pixKey: 'abc',
      createdAt: '2026-09-20T00:00:00.000Z',
      platform: 'ebook',
    };
    expect(validateReviewed([row])).toEqual([row]);
    expect(() => validateReviewed([{ ...row, fee: '0.00' }])).toThrow();
    expect(() => validateReviewed([row, row])).toThrow();
    expect(() => validateReviewed([{ ...row, userId: '' }])).toThrow();
  });
});
