import { mapDomWithdrawalStatus, reachedDomWithdrawalEnd, validateReviewed } from './recover-dom-withdrawals';

describe('DOM withdrawal recovery', () => {
  it('maps only known statuses', () => {
    expect(mapDomWithdrawalStatus('paid')).toBe('APPROVED');
    expect(mapDomWithdrawalStatus('cancelled')).toBe('REJECTED');
    expect(mapDomWithdrawalStatus('pending')).toBe('PENDING');
    expect(mapDomWithdrawalStatus('unknown')).toBeNull();
  });

  it('requires reconciled gross, net and fee', () => {
    const row = { userId: 'cliente-1', domWithdrawId: 'dom-1', status: 'COMPLETED', amount: '98.00',
      grossAmount: '100.00', fee: '2.00', pixKey: 'abc',
      createdAt: '2026-09-20T00:00:00.000Z', platform: 'ebook' };
    expect(validateReviewed([row])).toEqual([row]);
    expect(() => validateReviewed([{ ...row, fee: '0.00' }])).toThrow();
    expect(() => validateReviewed([row, row])).toThrow();
    expect(() => validateReviewed([{ ...row, userId: '' }])).toThrow();
  });

  it('continues pagination when DOM omits totals or caps page size', () => {
    expect(reachedDomWithdrawalEnd(1, 50, 0, 0, 50)).toBe(false);
    expect(reachedDomWithdrawalEnd(1, 50, 1, 150, 50)).toBe(false);
    expect(reachedDomWithdrawalEnd(3, 150, 3, 150, 50)).toBe(true);
    expect(reachedDomWithdrawalEnd(2, 50, 0, 0, 0)).toBe(true);
  });
});
