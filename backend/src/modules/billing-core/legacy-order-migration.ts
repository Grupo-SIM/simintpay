/**
 * `SubscriptionLinkOrder.status` of a pending Pix order that scripts/offer-pending-order-migration.ts
 * moved to the offer model (BillingContract + Charge + Transaction). The DOM webhook skips the
 * legacy handler for these orders, so the payment settles through the Transaction/Charge path.
 */
export const MIGRATED_ORDER_STATUS = 'migrated';
