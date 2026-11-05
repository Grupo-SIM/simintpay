import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PaymentLink } from '@prisma/client';
import {
  calculatePaymentLinkFees,
  getPlatformFeeRate,
} from './payment-link-fees.helper';
import {
  initializePlatformTaxasCache,
  readOverridesRaw,
} from '../../../modules/platform-taxas/platform-taxas.store';
import { initializePlatformRegistryCache } from '../../../modules/module.registry';
const platform = {
  id: 'shop',
  tag: 'SHOP',
  name: 'Shop',
  ownerUserId: 'owner',
  acquirer: 'DOM',
  customerInterestRates: { '2': 0.0352, '12': 0.3 },
  absorbCustomerInterest: false,
};
const client = {
  platformTaxaOverride: { findMany: async () => [] },
  platform: { findMany: async () => [platform] },
};
const empty = {
  platformTaxaOverride: { findMany: async () => [] },
  platform: { findMany: async () => [] },
};
const link = {
  amount: 100,
  isStandalone: false,
  platformFee2x: 99,
} as unknown as PaymentLink;
describe('separate platform interest and costs', () => {
  beforeEach(async () => {
    await initializePlatformRegistryCache(client as never);
    await initializePlatformTaxasCache(client as never);
  });
  afterEach(async () => {
    await initializePlatformRegistryCache(empty as never);
    await initializePlatformTaxasCache(empty as never);
  });
  test('admin cost changes never change customer interest', () => {
    expect(getPlatformFeeRate(link, 2, 'SHOP')).toBe(3.52);
    readOverridesRaw().SHOP = { LINK_COST_2X: 0.2 };
    expect(getPlatformFeeRate(link, 2, 'SHOP')).toBe(3.52);
    expect(calculatePaymentLinkFees(link, 2, 'SHOP').negativeMargin).toBe(true);
  });
  test('interest revenue belongs to platform; costs deducted once', () => {
    const fees = calculatePaymentLinkFees(link, 12, 'SHOP');
    expect(fees.netAmount).toBe(117);
    expect(fees.estimatedMargin).toBe(17);
  });
  test('warns individually for negative margin and permits absorption', () => {
    const normal = calculatePaymentLinkFees(link, 2, 'SHOP');
    expect(normal.negativeMargin).toBe(true);
    const absorbed = calculatePaymentLinkFees(link, 12, 'SHOP', false, true);
    expect(absorbed.totalAmount).toBe(100);
    expect(absorbed.negativeMargin).toBe(true);
  });
  test('platform 1x charges DOM 3.99% plus R$1 while keeping zero buyer interest', () => {
    const fees = calculatePaymentLinkFees(link, 1, 'SHOP');
    expect(fees.platformFeeRate).toBe(0);
    expect(fees.interestAmount).toBe(0);
    expect(fees.domFeeAmount).toBe(4.99);
    expect(fees.totalAmount).toBe(104.99);
    expect(fees.sellerFee).toBe(13);
    expect(fees.netAmount).toBe(87);
  });
  test('standalone 1x and PIX do not add interest', () => {
    expect(
      getPlatformFeeRate(
        { ...link, isStandalone: true } as PaymentLink,
        1,
        'SHOP',
      ),
    ).toBe(0);
    expect(calculatePaymentLinkFees(link, 1, 'SHOP', true).totalAmount).toBe(
      100,
    );
  });
});

test('credit matrix 1–12 keeps interest and excludes extra fees; zero overrides are honored', async () => {
  await initializePlatformRegistryCache(client as never);
  await initializePlatformTaxasCache(client as never);
  try {
    for (let n = 1; n <= 12; n++) {
      const fees = calculatePaymentLinkFees(link, n, 'SHOP');
      expect(fees.netAmount).toBe(
        Number(
          (fees.totalAmount - fees.domFeeAmount - fees.sellerFee).toFixed(2),
        ),
      );
      expect(fees.cashbackFee).toBe(0);
      expect(fees.transactionFixedFee).toBe(0);
    }
    readOverridesRaw().SHOP = { LINK_COST_1X: 0, TAXA_LINK_FIXA: 0 };
    const pix = calculatePaymentLinkFees(link, 1, 'SHOP', true);
    expect(pix.netAmount).toBe(100);
  } finally {
    await initializePlatformRegistryCache(empty as never);
    await initializePlatformTaxasCache(empty as never);
  }
});

test('debit keeps its method-specific cashback and fixed discounts', async () => {
  const { calculateDebitFees } = await import('./payment-link-fees.helper');
  const fees = calculateDebitFees(link, 'GLOBAL');
  expect(fees.cashbackFee).toBe(3);
  expect(fees.transactionFixedFee).toBe(1);
  expect(fees.netAmount).toBe(
    Number((100 - fees.domFeeAmount - fees.platformFeeAmount - 4).toFixed(2)),
  );
});

test('draft rates do not mutate checkout and absorption uses actual charged principal', async () => {
  await initializePlatformRegistryCache(client as never);
  await initializePlatformTaxasCache(client as never);
  try {
    const draft = calculatePaymentLinkFees(
      link,
      12,
      'SHOP',
      false,
      false,
      0.05,
    );
    expect(draft.interestAmount).toBe(5);
    expect(calculatePaymentLinkFees(link, 12, 'SHOP').interestAmount).toBe(30);
    const absorbed = calculatePaymentLinkFees(link, 12, 'SHOP', false, true);
    expect(absorbed.interestAmount).toBe(0);
    expect(absorbed.domFeeAmount).toBe(21.48);
    expect(absorbed.netAmount).toBe(65.52);
    readOverridesRaw().GLOBAL = { MDR_LINK_3X: 0.07 };
    expect(getPlatformFeeRate(link, 3, 'SHOP')).toBeCloseTo(7);
  } finally {
    await initializePlatformRegistryCache(empty as never);
    await initializePlatformTaxasCache(empty as never);
  }
});

test('PIX: domFeeAmount is the MDR_PIX acquirer cost, not the card rate; net and total unchanged', () => {
  const pix = calculatePaymentLinkFees(
    { amount: 100, isStandalone: true } as any,
    1,
    'GLOBAL',
    true,
  );
  expect(pix.domFeeAmount).toBe(0.98);
  expect(pix.totalAmount).toBe(100);
  expect(pix.netAmount).toBe(87);
});
