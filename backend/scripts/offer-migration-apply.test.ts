import { expect, test } from 'bun:test';
import { type Candidate, decide } from './offer-migration-apply';

const candidate = (
  legacyType: string,
  legacyId: string,
  code: string,
): Candidate =>
  ({
    draft: {
      legacyType,
      legacyId,
      code,
      amountCents: 5000,
      ownerUserId: 'u1',
      notes: [],
      issues: [],
      issueDetails: [],
    },
  }) as never;

const users = new Set(['u1']);

test('creates when the legacy id is free and unique', () => {
  const [d] = decide([candidate('PaymentLink', 'a', 'A')], users, []);
  expect(d.status).toBe('CREATE');
});

test('refuses with ID_COLLISION when the id repeats across legacy tables', () => {
  const ds = decide(
    [candidate('PaymentLink', 'a', 'A'), candidate('Boleto', 'a', 'B')],
    users,
    [],
  );
  expect(ds.map((d) => d.status)).toEqual(['REFUSED', 'REFUSED']);
  expect(ds[0].reasons.join()).toContain('ID_COLLISION');
});

test('refuses with ID_COLLISION when an Offer holds the id with another code', () => {
  const [d] = decide([candidate('Boleto', 'a', 'A')], users, [
    { id: 'a', code: 'X' },
  ]);
  expect(d.status).toBe('REFUSED');
  expect(d.reasons.join()).toContain('ID_COLLISION');
});

test('an already migrated product stays idempotent', () => {
  const [d] = decide([candidate('PaymentLink', 'a', 'A')], users, [
    { id: 'a', code: 'A' },
  ]);
  expect(d.status).toBe('SKIP_EXISTING');
});
