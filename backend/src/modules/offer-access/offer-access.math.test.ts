import { describe, expect, it } from 'bun:test';
import {
  DAY_MS,
  creditDays,
  remainingDaysOf,
  resumeAccess,
  suspendAccess,
} from './offer-access.math';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

describe('creditDays', () => {
  it('starts a fresh access from now', () => {
    const next = creditDays(null, 30, NOW);
    expect(next).toEqual({
      isActive: true,
      expiresAt: at(30),
      frozenDays: 0,
      totalDaysCredited: 30,
    });
  });

  it('stacks on the remaining time', () => {
    const current = {
      isActive: true,
      expiresAt: at(10),
      frozenDays: 0,
      totalDaysCredited: 30,
    };
    const next = creditDays(current, 30, NOW);
    expect(next.expiresAt).toEqual(at(40));
    expect(next.totalDaysCredited).toBe(60);
  });

  it('restarts from now when the previous access already expired', () => {
    const current = {
      isActive: false,
      expiresAt: at(-5),
      frozenDays: 0,
      totalDaysCredited: 30,
    };
    const next = creditDays(current, 30, NOW);
    expect(next.expiresAt).toEqual(at(30));
    expect(next.isActive).toBe(true);
  });

  it('keeps the frozen days of a suspended access', () => {
    const current = {
      isActive: false,
      expiresAt: at(-1),
      frozenDays: 12,
      totalDaysCredited: 30,
    };
    const next = creditDays(current, 30, NOW);
    expect(next.expiresAt).toEqual(at(42));
    expect(next.frozenDays).toBe(0);
    expect(next.isActive).toBe(true);
  });
});

describe('suspend / resume', () => {
  const active = {
    isActive: true,
    expiresAt: new Date(NOW.getTime() + 9.2 * DAY_MS),
    frozenDays: 0,
    totalDaysCredited: 30,
  };

  it('freezes the remaining days (rounded up) and expires now', () => {
    const s = suspendAccess(active, NOW);
    expect(s.isActive).toBe(false);
    expect(s.expiresAt).toEqual(NOW);
    expect(s.frozenDays).toBe(10);
    expect(s.totalDaysCredited).toBe(30);
  });

  it('resumes with the frozen days', () => {
    const r = resumeAccess(suspendAccess(active, NOW), at(3));
    expect(r?.isActive).toBe(true);
    expect(r?.expiresAt).toEqual(at(13));
    expect(r?.frozenDays).toBe(0);
  });

  it('resumes with an explicit day count when informed', () => {
    const r = resumeAccess(suspendAccess(active, NOW), NOW, 5);
    expect(r?.expiresAt).toEqual(at(5));
  });

  it('refuses to resume without days', () => {
    expect(
      resumeAccess({ ...active, isActive: false, frozenDays: 0 }, NOW),
    ).toBeNull();
  });

  it('remainingDaysOf never goes below zero', () => {
    expect(remainingDaysOf(at(-3), NOW)).toBe(0);
    expect(remainingDaysOf(at(2), NOW)).toBe(2);
  });
});
