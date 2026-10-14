import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformPaymentsService } from './platform-payments.service';
import { LegacyPlatformPaymentCore } from './legacy-platform-payment.core';
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
  const prisma = { platform: { findUnique: async () => platform }, platformTaxaOverride: { findMany: async () => [] }, wallet: { findUnique: async () => ({ id: 'wallet' }), update: mock() },
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
    status: row.status, userId: row.userId, method: row.paymentMethod, installments: row.installments, acquirer: row.acquirer, paymentId: row.domPaymentId };
}

describe('Legacy and canonical payment execution equivalence', () => {
  for (const [tag, config] of [['ATLAS', AtlasConfig], ['BOSQUE', BosqueConfig], ['RENOVADA', RenovadaConfig], ['ZERO-GRAU', ZeroGrauConfig]] as const) {
    for (const method of ['PIX', 'CREDIT_CARD'] as const) {
      test(`${tag} ${method}: reais alias and cents API persist same financial contract`, async () => {
        const legacy = fixture(tag), canonical = fixture(tag);
        const adapter = new LegacyPlatformPaymentCore(legacy.prisma as never, undefined, tag, config);
        Object.assign(adapter, { createDomPagamentosPix: async () => remote, createDomPagamentosCreditCard: async () => remote });
        const service = new PlatformPaymentsService(canonical.prisma as never, { byAcquirer: () => ({ createPixCheckout: async () => ({ id: remote.id, status: remote.status, pixContent: remote.pix_content, qrCode: remote.pix_qrcode }) }) } as never);
        globalThis.fetch = mock(async () => new Response(JSON.stringify(remote), { status: 200 })) as unknown as typeof fetch;
        const result = method === 'PIX' ? await adapter.createPaymentPix('owner', body) : await adapter.createPaymentCreditCard('owner', body);
        const current = await service.create(canonical.platform as never, { amountCents: 12345, paymentMethod: method, idempotencyKey: 'purchase', description: body.description,
          customer: { name: body.name, email: body.email, document: body.document, documentType: 'CPF', phone: body.mobile_phone },
          ...(method === 'CREDIT_CARD' ? { card: { token: body.token, holderName: body.holder_name, bin: body.bin, brand: body.brand, installments: 3 } } : {}) });
        expect(financial(legacy.stored())).toEqual(financial(canonical.stored()));
        expect(result).toMatchObject({ paymentId: current.paymentId, status: current.status });
        expect(current.amountCents).toBe(body.price * 100);
        expect(legacy.prisma.wallet.update).not.toHaveBeenCalled();
        expect(canonical.prisma.wallet.update).not.toHaveBeenCalled();
        expect(legacy.prisma.transaction.create).toHaveBeenCalledTimes(1);
      });
    }
  }
});
