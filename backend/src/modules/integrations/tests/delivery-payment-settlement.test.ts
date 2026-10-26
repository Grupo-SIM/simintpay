import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { initializePlatformRegistryCache } from '../../module.registry';
import { IntegrationPaymentService } from '../integration-payment.service';
import { LegacyPlatformPaymentCore } from '../../unified-platform/payments/legacy-platform-payment.core';
import { settleFinalNet } from '../../platform-core/link-settlement';

const key = 'sim-delivery_zero-grau';
const owner = { isActive: true, isPurged: false };
const platform = { id: 'platform', tag: 'ZERO-GRAU', name: 'Zero Grau', ownerUserId: 'owner', acquirer: 'DOM', isActive: true, owner };
const input = { price: 105.37, allocation: { merchantAmountCents: 10000, platformFeeCents: 537 },
  document: '52998224725', document_type: 'CPF', email: 'buyer@example.com', name: 'Maria Silva',
  holder_name: 'Maria Silva', token: 'test-token', bin: '424242', brand: 'visa', installments: 1 };
const d = (n: number) => new Prisma.Decimal(n);

function fixture() {
  let row: any;
  const wallet = { id: 'wallet', balance: d(0), lockedBalance: d(0), version: 0 };
  const logs: any[] = [];
  const merchant = { id: 'merchant', userId: 'seller', integrationKey: key, user: owner };
  const p: any = {
    platform: { findUnique: async () => platform },
    platformIntegration: { findMany: async () => [{ url: key, platform }], findUnique: async () => ({ url: key }) },
    integrationMerchant: { findUnique: async () => merchant },
    financialPolicyRevision: { findMany: mock(async () => { throw new Error('Must not apply standard financial policy'); }) },
    transaction: {
      create: mock(async ({ data }: any) => { row = { id: 'sale', ...data, amount: d(data.amount), netAmount: d(data.netAmount), platformFee: d(data.platformFee) }; return { ...row }; }),
      update: async ({ data }: any) => { Object.assign(row, data); return { ...row }; },
      updateMany: async ({ where, data }: any) => { if (where.status && row.status !== where.status) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
    wallet: { upsert: async () => wallet, findUnique: async () => ({ ...wallet }), updateMany: async ({ where, data }: any) => {
      if (where.version !== wallet.version) return { count: 0 };
      Object.assign(wallet, data, { version: wallet.version + 1 }); return { count: 1 };
    } },
    balanceLog: { findFirst: async () => logs.find(l => l.action === 'LINK_SETTLEMENT_COMPLETED'), create: async ({ data }: any) => { logs.push(data); } },
    transactionStatusHistory: { create: async () => ({}) },
    user: { findUnique: async () => null }, affiliateCommission: { findUnique: async () => null },
  };
  const service = new IntegrationPaymentService(p, { merchant: async () => merchant } as never, {} as never);
  return { p, service, row: () => ({ ...row }), wallet, logs };
}

describe('Delivery internal charge and wallet allocation', () => {
  beforeEach(async () => {
    await initializePlatformRegistryCache({ platform: { findMany: async () => [platform] } } as never);
  });

  for (const method of ['pix', 'card'] as const) test(`${method}: stores allocation, charges exact total, credits and reverses only merchant share once`, async () => {
    const f = fixture();
    const transport = spyOn(LegacyPlatformPaymentCore.prototype as any, method === 'pix' ? 'createDomPagamentosPix' : 'createDomPagamentosCreditCard')
      .mockResolvedValue({ id: 'gateway', status: 'pending', pix_qrcode: 'qr', pix_content: 'copy' });
    try {
      await f.service[method](key, 'company', input);
      expect(transport.mock.calls[0][0]).toMatchObject({ payment: { total: 105.37 } });
      expect(f.row()).toMatchObject({ userId: 'seller', settlementBasis: 'FINAL_NET', totalFee: 5.37, domFee: 0,
        financialSnapshot: { contract: 'SIM_DELIVERY_ALLOCATION_V1', totalAmountCents: 10537, merchantAmountCents: 10000, platformFeeCents: 537 } });
      expect(f.row().netAmount.toNumber()).toBe(100);
      expect(f.row().platformFee.toNumber()).toBe(5.37);
      expect(f.p.financialPolicyRevision.findMany).not.toHaveBeenCalled();
      expect(f.wallet.balance.toNumber()).toBe(0);
      const pending = f.row();
      await settleFinalNet(f.p, pending, 'COMPLETED', 'WEBHOOK');
      await settleFinalNet(f.p, pending, 'COMPLETED', 'POLLING');
      expect(f.wallet.balance.toNumber()).toBe(100);
      expect(f.logs).toHaveLength(1);
      await settleFinalNet(f.p, f.row(), 'REFUNDED', 'REFUND');
      expect(f.wallet.balance.toNumber()).toBe(0);
      expect(f.logs).toHaveLength(2);
    } finally { transport.mockRestore(); }
  });

  test('missing or inconsistent allocation cannot create a charge', async () => {
    const f = fixture();
    await expect(f.service.pix(key, 'company', { ...input, allocation: undefined })).rejects.toThrow('obrigatória');
    await expect(f.service.card(key, 'company', { ...input, price: 105 })).rejects.toThrow('difere');
    expect(f.p.transaction.create).not.toHaveBeenCalled();
  });
});
