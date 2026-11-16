import { expect, test } from 'bun:test';
import {
  buildUpdate,
  classifyDiffs,
  type ClassifyContext,
  diffOffer,
  type FieldDiff,
  type OfferRow,
  parseDeltaArgs,
} from './offer-migration-delta';

const t0 = new Date('2026-11-01T10:00:00Z');
const later = new Date('2026-11-05T10:00:00Z');
const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
  legacyUpdatedAt: later,
  offerCreatedAt: t0,
  offerUpdatedAt: t0,
  overwrite: false,
  skipActive: false,
  ...over,
});
const diff = (field: FieldDiff['field'], offer: unknown, legacy: unknown) =>
  ({ field, offer, legacy }) as FieldDiff;

test('CLI: dry run by default, --apply needs the explicit acknowledgement', () => {
  const base = ['--database-url=postgresql://h/d'];
  expect(parseDeltaArgs(base)).toMatchObject({ apply: false, verify: false });
  expect(() => parseDeltaArgs([...base, '--apply'])).toThrow(
    '--i-understand-this-writes',
  );
  expect(() => parseDeltaArgs([...base, '--overwrite'])).toThrow(
    'explicit ids',
  );
  expect([...parseDeltaArgs([...base, '--overwrite=a, b']).overwrite]).toEqual([
    'a',
    'b',
  ]);
});

test('usedCount only goes up; a bigger Offer counter is a conflict', () => {
  const [up] = classifyDiffs([diff('usedCount', 0, 3)], ctx());
  expect(up.resolution).toBe('AUTO');
  const [down] = classifyDiffs([diff('usedCount', 6, 5)], ctx());
  expect(down.resolution).toBe('CONFLICT');
  expect(down.reason).toContain('OFFER_AHEAD');
  const [forced] = classifyDiffs(
    [diff('usedCount', 6, 5)],
    ctx({ overwrite: true }),
  );
  expect(forced.resolution).toBe('AUTO');
});

test('amount below the minimum is never copied, even with overwrite', () => {
  const [d] = classifyDiffs(
    [diff('amountCents', 10000, 500)],
    ctx({ overwrite: true }),
  );
  expect(d.resolution).toBe('CONFLICT');
  expect(d.reason).toContain('BELOW_MINIMUM');
});

test('fields copy only when the legacy row changed and the Offer did not', () => {
  const [ok] = classifyDiffs([diff('name', 'a', 'b')], ctx());
  expect(ok.resolution).toBe('AUTO');
  const [edited] = classifyDiffs(
    [diff('name', 'a', 'b')],
    ctx({ offerUpdatedAt: later }),
  );
  expect(edited.reason).toContain('BOTH_CHANGED');
  const [stale] = classifyDiffs(
    [diff('name', 'a', 'b')],
    ctx({ legacyUpdatedAt: t0 }),
  );
  expect(stale.reason).toContain('OFFER_EDITED');
  expect(classifyDiffs([diff('code', 'A', 'B')], ctx())[0].resolution).toBe(
    'CONFLICT',
  );
});

test('isActive follows the legacy row unless --skip-active', () => {
  expect(
    classifyDiffs(
      [diff('isActive', true, false)],
      ctx({ offerUpdatedAt: later }),
    )[0].resolution,
  ).toBe('AUTO');
  expect(
    classifyDiffs([diff('isActive', true, false)], ctx({ skipActive: true })),
  ).toEqual([]);
});

test('buildUpdate keeps the JSON keys the legacy row does not own', () => {
  const offer = {
    fulfillment: { redirectUrl: 'https://old', files: [{ id: 'f' }] },
    metadata: null,
  } as unknown as OfferRow;
  const draft = {
    fulfillment: { redirectUrl: 'https://new' },
    usedCount: 4,
  } as never;
  const data = buildUpdate(draft, offer, [
    { field: 'fulfillment', offer: null, legacy: null, resolution: 'AUTO' },
    { field: 'usedCount', offer: 0, legacy: 4, resolution: 'AUTO' },
    { field: 'name', offer: 'x', legacy: 'y', resolution: 'CONFLICT' },
  ]);
  expect(data).toEqual({
    fulfillment: { redirectUrl: 'https://new', files: [{ id: 'f' }] },
    usedCount: 4,
  });
});

test('diffOffer ignores keys owned by the Offer and key order', () => {
  const draft = {
    name: 'n',
    usedCount: 1,
    acceptedMethods: ['PIX', 'CREDIT_CARD'],
    fulfillment: { redirectUrl: 'https://a' },
    expiresAt: null,
  } as never;
  const offer = {
    name: 'n',
    usedCount: 2,
    acceptedMethods: ['CREDIT_CARD', 'PIX'],
    fulfillment: { files: [], redirectUrl: 'https://a' },
    expiresAt: null,
  } as unknown as OfferRow;
  expect(diffOffer(draft, offer).map((d) => d.field)).toEqual(['usedCount']);
});
