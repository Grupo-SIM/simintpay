import { expect, test } from 'bun:test';
import { ownedReportSource } from './owned-report-source';

const scope = [{ id: 'p1', tag: 'SHOP', ownerUserId: 'u1' }];

test('joins Offer by the legacy id and never touches the legacy tables', () => {
  const { sql } = ownedReportSource(scope, {});
  expect(sql).toContain(
    '"Offer" l ON l.id = coalesce(t."offerId", t."paymentLinkId")',
  );
  expect(sql).toContain('"Offer" sl ON sl.id = o."subscriptionLinkId"');
  expect(sql).not.toContain('"PaymentLink"');
  expect(sql).not.toContain('"SubscriptionLink"');
});
