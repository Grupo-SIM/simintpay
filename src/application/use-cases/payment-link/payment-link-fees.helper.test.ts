import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PaymentLink } from '@prisma/client';
import { calculatePaymentLinkFees, getPlatformFeeRate } from './payment-link-fees.helper';
import { initializePlatformTaxasCache, readOverridesRaw } from '../../../modules/platform-taxas/platform-taxas.store';
import { initializePlatformRegistryCache } from '../../../modules/module.registry';
const platform = { id: 'shop', tag: 'SHOP', name: 'Shop', ownerUserId: 'owner', acquirer: 'DOM', customerInterestRates: { '2': 0.0352, '12': 0.3 }, absorbCustomerInterest: false };
const client = { platformTaxaOverride: { findMany: async () => [] }, platform: { findMany: async () => [platform] } };
const empty = { platformTaxaOverride: { findMany: async () => [] }, platform: { findMany: async () => [] } };
const link = { amount: 100, isStandalone: false, platformFee2x: 99 } as unknown as PaymentLink;
describe('separate platform interest and costs', () => {
  beforeEach(async () => { await initializePlatformRegistryCache(client as never); await initializePlatformTaxasCache(client as never); });
  afterEach(async () => { await initializePlatformRegistryCache(empty as never); await initializePlatformTaxasCache(empty as never); });
  test('admin cost changes never change customer interest', () => {
    expect(getPlatformFeeRate(link, 2, 'SHOP')).toBe(3.52);
    readOverridesRaw().SHOP = { LINK_COST_2X: 0.2 };
    expect(getPlatformFeeRate(link, 2, 'SHOP')).toBe(3.52);
    expect(calculatePaymentLinkFees(link, 2, 'SHOP').negativeMargin).toBe(true);
  });
  test('interest revenue belongs to platform; costs deducted once', () => {
    const fees = calculatePaymentLinkFees(link, 12, 'SHOP');
    expect(fees.netAmount).toBe(115.01);
    expect(fees.estimatedMargin).toBe(15.01);
  });
  test('warns individually for negative margin and permits absorption', () => {
    const normal = calculatePaymentLinkFees(link, 2, 'SHOP');
    expect(normal.negativeMargin).toBe(true);
    const absorbed = calculatePaymentLinkFees(link, 12, 'SHOP', false, true);
    expect(absorbed.totalAmount).toBe(100);
    expect(absorbed.negativeMargin).toBe(true);
  });
  test('standalone 1x and PIX do not add interest', () => {
    expect(getPlatformFeeRate({ ...link, isStandalone: true } as PaymentLink, 1, 'SHOP')).toBe(0);
    expect(calculatePaymentLinkFees(link, 1, 'SHOP', true).totalAmount).toBe(100);
  });
});
