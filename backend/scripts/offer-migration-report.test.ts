import { expect, test } from 'bun:test';
import {
  mapBoleto,
  mapPaymentLink,
} from '../src/modules/offer/legacy-offer-mapper';
import {
  describeTarget,
  findConflicts,
  resolveDatabaseUrl,
} from './offer-migration-report';

test('refuses to run without an explicit database url', () => {
  expect(() =>
    resolveDatabaseUrl([], { DATABASE_URL: 'postgresql://x@h/db' }),
  ).toThrow('Refusing');
  expect(resolveDatabaseUrl(['--database-url=postgresql://a@h1/d'], {})).toBe(
    'postgresql://a@h1/d',
  );
  expect(
    resolveDatabaseUrl([], {
      OFFER_REPORT_DATABASE_URL: 'postgresql://b@h2/d',
    }),
  ).toBe('postgresql://b@h2/d');
  expect(describeTarget('postgresql://u:secret@db.example:6543/app')).toBe(
    'db.example:6543/app',
  );
});

test('detects duplicate codes, admin owners, missing owners and low amounts', () => {
  const drafts = [
    mapPaymentLink({
      id: '1',
      userId: 'u',
      code: 'dup',
      title: 't',
      amount: '10.00',
    }),
    mapBoleto({
      id: '2',
      userId: 'admin',
      code: 'dup',
      title: 't',
      amount: '20.00',
    }),
    mapBoleto({
      id: '3',
      userId: 'ghost',
      code: 'ok',
      title: 't',
      amount: '14.98',
    }),
    mapBoleto({
      id: '4',
      userId: 'u',
      code: 'edge',
      title: 't',
      amount: '14.99',
    }),
  ];
  const c = findConflicts(
    drafts,
    new Map([
      ['u', 'USER'],
      ['admin', 'ADMIN'],
    ]),
    new Set(['u', 'admin']),
  );
  expect(c.duplicateCodes).toEqual([
    { code: 'dup', sources: ['PaymentLink:1', 'Boleto:2'] },
  ]);
  expect(c.adminOwner).toEqual(['Boleto:2']);
  expect(c.missingOwner).toEqual(['Boleto:3']);
  expect(c.belowMinimumAmount).toEqual(['PaymentLink:1', 'Boleto:3']);
  expect(c.notes).toEqual([]);
});

test('reports invalid fulfillment and preflight blockers', () => {
  const draft = mapPaymentLink({
    id: 'p1',
    userId: 'u',
    code: 'c',
    title: 't',
    amount: '20.00',
    webhookUrl: 'http://localhost/hook',
  });
  const conflicts = findConflicts(
    [draft],
    new Map(),
    new Set(['u']),
    new Map([
      [
        'PaymentLink:p1',
        {
          blockers: [
            {
              code: 'BLOCKED_HAS_FILES' as const,
              detail: '2 delivery file(s)',
            },
          ],
          notes: ['FEE_OVERRIDE_NOT_CARRIED: platformFee1x'],
        },
      ],
    ]),
  );
  expect(conflicts.invalidFulfillment.join()).toContain('PaymentLink:p1');
  expect(conflicts.blocked).toEqual([
    'PaymentLink:p1: BLOCKED_HAS_FILES: 2 delivery file(s)',
  ]);
  expect(conflicts.notes.join()).toContain('FEE_OVERRIDE_NOT_CARRIED');
});
