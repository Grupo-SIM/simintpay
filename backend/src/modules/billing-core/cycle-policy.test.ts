import { expect, test } from 'bun:test';
import { advanceInterval, onCycleFailed, onCyclePaid } from './cycle-policy';

const monthly = {
  intervalType: 'MONTH' as const,
  intervalCount: 1,
  repetitions: null,
  retryDays: 3,
  graceDays: 7,
};
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

test('advances calendar intervals in UTC', () => {
  expect(advanceInterval(d('2026-01-15'), 'MONTH', 1)).toEqual(d('2026-02-15'));
  expect(advanceInterval(d('2026-01-15'), 'WEEK', 2)).toEqual(d('2026-01-29'));
  expect(advanceInterval(d('2026-01-15'), 'YEAR', 1)).toEqual(d('2027-01-15'));
  expect(advanceInterval(d('2026-01-15'), 'DAY', 10)).toEqual(d('2026-01-25'));
});

test('first paid cycle starts when the buyer pays', () => {
  const next = onCyclePaid(
    { currentPeriodEnd: d('2026-01-01'), pastDueAt: null, retryCount: 0 },
    monthly,
    1,
    d('2026-01-05'),
  );
  expect(next.status).toBe('ACTIVE');
  expect(next.currentPeriodStart).toEqual(d('2026-01-05'));
  expect(next.currentPeriodEnd).toEqual(d('2026-02-05'));
  expect(next.nextChargeAt).toEqual(d('2026-02-05'));
});

test('renewals continue from the previous period end, not the payment date', () => {
  const next = onCyclePaid(
    {
      currentPeriodEnd: d('2026-02-05'),
      pastDueAt: d('2026-02-06'),
      retryCount: 2,
    },
    monthly,
    2,
    d('2026-02-09'),
  );
  expect(next.currentPeriodStart).toEqual(d('2026-02-05'));
  expect(next.currentPeriodEnd).toEqual(d('2026-03-05'));
  expect(next.pastDueAt).toBeNull();
  expect(next.retryCount).toBe(0);
});

test('finishes after the configured number of cycles', () => {
  const next = onCyclePaid(
    { currentPeriodEnd: d('2026-03-05'), pastDueAt: null, retryCount: 0 },
    { ...monthly, repetitions: 3 },
    3,
    d('2026-03-05'),
  );
  expect(next.status).toBe('INACTIVE');
  expect(next.nextChargeAt).toBeNull();
});

test('failed charge retries until grace runs out, then suspends', () => {
  const state = {
    currentPeriodEnd: d('2026-02-05'),
    pastDueAt: null,
    retryCount: 0,
  };
  const first = onCycleFailed(state, monthly, d('2026-02-05'));
  expect(first.status).toBe('PAST_DUE');
  expect(first.nextChargeAt).toEqual(d('2026-02-08'));
  expect(first.graceEndsAt).toEqual(d('2026-02-12'));

  const second = onCycleFailed(
    { ...state, pastDueAt: first.pastDueAt, retryCount: 1 },
    monthly,
    d('2026-02-08'),
  );
  expect(second.status).toBe('PAST_DUE');
  expect(second.nextChargeAt).toEqual(d('2026-02-11'));

  const third = onCycleFailed(
    { ...state, pastDueAt: first.pastDueAt, retryCount: 2 },
    monthly,
    d('2026-02-11'),
  );
  expect(third.status).toBe('SUSPENDED');
  expect(third.nextChargeAt).toBeNull();
});
