import { expect, test } from 'bun:test';
import { ownedReportSource } from './owned-report-source';
import { offersReadEnabled } from '../../shared/utils/offer-read-flag';

const scope = [{ id: 'p1', tag: 'SHOP', ownerUserId: 'u1' }];

test('legacy read is the default and joins the legacy product tables', () => {
  const { sql } = ownedReportSource(scope, {}, false);
  expect(sql).toContain('"PaymentLink" l');
  expect(sql).toContain('"SubscriptionLink" sl');
  expect(sql).not.toContain('"Offer"');
});

test('offer read joins Offer by the legacy id and never touches the legacy tables', () => {
  const { sql } = ownedReportSource(scope, {}, true);
  expect(sql).toContain(
    '"Offer" l ON l.id = coalesce(t."offerId", t."paymentLinkId")',
  );
  expect(sql).toContain('"Offer" sl ON sl.id = o."subscriptionLinkId"');
  expect(sql).not.toContain('"PaymentLink"');
  expect(sql).not.toContain('"SubscriptionLink"');
});

test('flag is off unless OFFERS_READ_ENABLED is true or 1', () => {
  expect(offersReadEnabled({})).toBe(false);
  expect(offersReadEnabled({ OFFERS_READ_ENABLED: 'false' })).toBe(false);
  expect(offersReadEnabled({ OFFERS_READ_ENABLED: 'true' })).toBe(true);
  expect(offersReadEnabled({ OFFERS_READ_ENABLED: '1' })).toBe(true);
});
