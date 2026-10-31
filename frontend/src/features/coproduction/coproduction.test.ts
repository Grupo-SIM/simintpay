import { describe, expect, test } from 'bun:test';
import {
  formatPercentage,
  maskPercentage,
  parseCoproduction,
  percentageBps,
  serializeParticipants,
  validateParticipants,
} from './coproduction';

const row = (email: string, percentage: string) => ({
  id: email,
  email,
  percentage,
});

describe('coproduction percentages', () => {
  test('uses integer basis points without float accumulation', () => {
    expect(percentageBps('33,33')).toBe(3333);
    expect(percentageBps('0,01')).toBe(1);
    expect(formatPercentage(2550)).toBe('25,5');
    expect(maskPercentage('25.50%')).toBe('25,50');
    expect(
      validateParticipants([
        row('a@a.test', '33,33'),
        row('b@b.test', '33,33'),
        row('c@c.test', '33,34'),
      ]),
    ).toBeNull();
    expect(
      validateParticipants([row('a@a.test', '99,99'), row('b@b.test', '0,02')]),
    ).toContain('100%');
  });
  test('rejects nonpositive, malformed and excessive shares', () => {
    for (const value of [
      '',
      '0',
      '-1',
      '100,01',
      'NaN',
      'Infinity',
      '1,234',
      '1e2',
      '1.2',
      '20,',
    ]) {
      expect(validateParticipants([row('a@a.test', value)])).not.toBeNull();
    }
    expect(validateParticipants([row('a@a.test', '100')])).toBeNull();
    expect(validateParticipants([])).toBeNull();
  });
  test('normalizes email, rejects duplicates and owner participation', () => {
    expect(
      serializeParticipants([row(' Person@Example.Test ', '25,5')]),
    ).toEqual([{ email: 'person@example.test', percentageBps: 2550 }]);
    expect(
      validateParticipants([
        row('person@example.test', '10'),
        row(' PERSON@example.test ', '20'),
      ]),
    ).toContain('duas vezes');
    expect(
      validateParticipants(
        [row('owner@example.test', '10')],
        'OWNER@example.test',
      ),
    ).toContain('proprietário');
    expect(validateParticipants([row('invalid', '10')])).toContain('e-mail');
  });
  test('server errors or incomplete responses never become an empty agreement', () => {
    for (const value of [
      null,
      {},
      { participants: [] },
      { basis: 'GROSS', version: 1, participants: [] },
      { basis: 'NET', version: -1, participants: [] },
      {
        basis: 'NET',
        version: 1,
        participants: [{ email: 'a@a.test', percentageBps: 1.5 }],
      },
      {
        basis: 'NET',
        version: 1,
        participants: [{ email: 'a@a.test', percentageBps: 10001 }],
      },
    ]) {
      expect(() => parseCoproduction(value)).toThrow();
    }
    expect(
      parseCoproduction({ basis: 'NET', version: 0, participants: [] }),
    ).toEqual({ basis: 'NET', version: 0, participants: [] });
  });
});
