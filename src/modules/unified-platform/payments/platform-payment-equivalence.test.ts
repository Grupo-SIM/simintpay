import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformPaymentsService } from './platform-payments.service';
import { LegacyPlatformPaymentCore } from './legacy-platform-payment.core';
import { acceptsPlatformSyncDescription } from '../../platform-core/platform-sync.adapter';
import { AtlasConfig } from '../../atlas/atlas.config';
import { BosqueConfig } from '../../bosque/bosque.config';
import { RenovadaConfig } from '../../renovada/renovada.config';
import { ZeroGrauConfig } from '../../zero-grau/zero-grau.config';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
import { encryptPlatformSecret } from '../../platform-integrations/platform-secrets';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
beforeAll(async () => { await initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [] } } as never); });
const body = { price: 123.45, document: '52998224725', document_type: 'CPF', email: 'buyer@example.com', name: 'Maria Silva', mobile_phone: '81999999999', description: 'Produto', holder_name: 'Maria Silva', token: 'test-card', bin: '424242', brand: 'visa', installments: 3 };
const remote = { id: 'remote-payment', status: 'pending', pix_content: 'pix', pix_qrcode: 'qr' };
function fixture(tag: string) {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
  let stored: any;
  const platform = { id: 'p', tag, ownerUserId: 'owner', isActive: true, acquirer: 'DOM', owner: { isActive: true, isPurged: false }, integrations: [{ key: 'DOM_TOKEN', encryptedValue: encryptPlatformSecret('test-only') }] };
  const prisma = { financialPolicyRevision: { findMany: async () => [] }, platform: { findUnique: async () => platform }, platformTaxaOverride: { findMany: async () => [] }, wallet: { findUnique: async () => ({ id: 'wallet' }), upsert: mock(async () => ({ id: 'wallet' })), update: mock() },
    transaction: {
      findUnique: async () => stored ?? null,
      create: mock(async ({ data }: any) => { stored = { id: 'legacy-payment', ...data }; return stored; }),
      updateMany: mock(async ({ where, data }: any) => { if (stored.status !== where.status) return { count: 0 }; stored = { ...stored, ...data }; return { count: 1 }; }),
      update: mock(async ({ data }: any) => { stored = { ...stored, ...data }; return stored; }),
    } };
  return { prisma, platform, stored: () => stored };
}
function financial(row: any) {
  return { amount: new Prisma.Decimal(row.amount).toString(), net: new Prisma.Decimal(row.netAmount).toString(), total: new Prisma.Decimal(row.totalFee).toString(), gateway: new Prisma.Decimal(row.domFee).toString(), fee: new Prisma.Decimal(row.platformFee).toString(),
    settlementBasis: row.settlementBasis, tracking: row.tracking, status: row.status, userId: row.userId, method: row.paymentMethod, installments: row.installments, acquirer: row.acquirer, paymentId: row.domPaymentId };
}

describe('Legacy and canonical payment execution equivalence', () => {
  for (const [tag, config] of [['ATLAS', AtlasConfig], ['BOSQUE', BosqueConfig], ['RENOVADA', RenovadaConfig], ['ZERO-GRAU', ZeroGrauConfig]] as const) {
    for (const method of ['PIX', 'CREDIT_CARD'] as const) for (const merchant of [false, true]) {
      test(`${tag} ${method} ${merchant ? "merchant" : "owner"}: reais alias and cents API persist same financial contract`, async () => {
        const legacy = fixture(tag), canonical = fixture(tag);
        const account = merchant ? 'seller' : 'owner';
        const description = tag === 'ATLAS' ? (method === 'PIX' ? 'DOMAIN example.com' : 'HOSTING VPS-10-1784846') : body.description;
        for (const f of [legacy, canonical]) {
          (f.prisma as any).integrationMerchant = { findUnique: async () => ({ id: 'merchant', integrationKey: f === legacy ? 'legacy' : 'platform:p', userId: account, user: { isActive: true, isPurged: false } }) };
          (f.prisma as any).platformIntegration = { findUnique: async () => ({ url: 'legacy' }) };
        }
        const adapter = new LegacyPlatformPaymentCore(legacy.prisma as never, undefined, tag, config, merchant ? 'merchant' : undefined);
        const legacyCharge = mock(async (_request: any) => remote);
        Object.assign(adapter, { createDomPagamentosPix: legacyCharge, createDomPagamentosCreditCard: legacyCharge });
        const service = new PlatformPaymentsService(canonical.prisma as never, { byAcquirer: () => ({ createPixCheckout: async () => ({ id: remote.id, status: remote.status, pixContent: remote.pix_content, qrCode: remote.pix_qrcode }) }) } as never);
        globalThis.fetch = mock(async () => new Response(JSON.stringify(remote), { status: 200 })) as unknown as typeof fetch;
        const result = method === 'PIX' ? await adapter.createPaymentPix(account, { ...body, description }) : await adapter.createPaymentCreditCard(account, { ...body, description });
        const execute = merchant ? (input: any) => service.createForMerchant(canonical.platform as never, 'external', input) : (input: any) => service.create(canonical.platform as never, input);
        const current = await execute({ amountCents: 12345, paymentMethod: method, idempotencyKey: 'purchase', description,
          customer: { name: body.name, email: body.email, document: body.document, documentType: 'CPF', phone: body.mobile_phone },
          ...(method === 'CREDIT_CARD' ? { card: { token: body.token, holderName: body.holder_name, bin: body.bin, brand: body.brand, installments: 3 } } : {}) });
        expect(financial(legacy.stored())).toEqual(financial(canonical.stored()));
        expect(legacy.stored().settlementBasis).toBe('FINAL_NET');
        const providerDescription = legacyCharge.mock.calls[0][0].items.description;
        expect(providerDescription).toContain(description);
        expect(acceptsPlatformSyncDescription(providerDescription, tag)).toBe(true);
        expect(result).toMatchObject({ paymentId: current.paymentId, status: current.status });
        expect(current.amountCents).toBe(body.price * 100);
        expect(legacy.prisma.wallet.update).not.toHaveBeenCalled();
        expect(canonical.prisma.wallet.update).not.toHaveBeenCalled();
        expect(legacy.prisma.transaction.create).toHaveBeenCalledTimes(1);
      });
    }
  }
});


describe('Legacy checkout wallet initialization', () => {
  for (const method of ['PIX', 'CREDIT_CARD'] as const) {
    for (const existing of [false, true]) {
      test(`${method}: ${existing ? 'preserves existing balances' : 'creates missing wallet'} before charging`, async () => {
        const f = fixture('RENOVADA');
        let wallet = existing ? { userId: 'owner', balance: 120, lockedBalance: 30 } : null;
        f.prisma.wallet.upsert = mock(async ({ where, update, create }: any) => {
          expect(where).toEqual({ userId: 'owner' });
          expect(update).toEqual({});
          wallet ??= create;
          return { id: 'wallet', ...wallet };
        });
        const adapter = new LegacyPlatformPaymentCore(f.prisma as never, undefined, 'RENOVADA', RenovadaConfig);
        const charge = mock(async () => {
          expect(wallet).toEqual({ userId: 'owner', balance: existing ? 120 : 0, lockedBalance: existing ? 30 : 0 });
          return remote;
        });
        Object.assign(adapter, { createDomPagamentosPix: charge, createDomPagamentosCreditCard: charge });
        if (method === 'PIX') await adapter.createPaymentPix('owner', body);
        else await adapter.createPaymentCreditCard('owner', body);
        expect(f.prisma.wallet.upsert).toHaveBeenCalledTimes(1);
        expect(charge).toHaveBeenCalledTimes(1);
      });
    }
    test(`${method}: rejects wrong owner before creating wallet or charging`, async () => {
      const f = fixture('RENOVADA');
      const adapter = new LegacyPlatformPaymentCore(f.prisma as never, undefined, 'RENOVADA', RenovadaConfig);
      const charge = mock(async () => remote);
      Object.assign(adapter, { createDomPagamentosPix: charge, createDomPagamentosCreditCard: charge });
      const result = method === 'PIX' ? adapter.createPaymentPix('other', body) : adapter.createPaymentCreditCard('other', body);
      await expect(result).rejects.toThrow('Plataforma pertence a outro dono');
      expect(f.prisma.wallet.upsert).not.toHaveBeenCalled();
      expect(charge).not.toHaveBeenCalled();
    });
  }
});

describe('Atlas payment response follows committed financial status', () => {
  for (const method of ['PIX', 'CREDIT_CARD'] as const) {
    test(`${method}: provider approval cannot report local completion before settlement`, async () => {
      const f = fixture('ATLAS');
      const adapter = new LegacyPlatformPaymentCore(f.prisma as never, undefined, 'ATLAS', AtlasConfig);
      const charge = mock(async () => ({ ...remote, status: 'paid' }));
      Object.assign(adapter, { createDomPagamentosPix: charge, createDomPagamentosCreditCard: charge });
      const result = method === 'PIX' ? await adapter.createPaymentPix('owner', body) : await adapter.createPaymentCreditCard('owner', body);
      expect(result.status).toBe(f.stored().status);
      expect(result.status).toBe('PENDING');
      expect(f.stored().settlementBasis).toBe('FINAL_NET');
      expect(f.prisma.wallet.update).not.toHaveBeenCalled();
    });
  }
});
