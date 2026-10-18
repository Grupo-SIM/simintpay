import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformPaymentsService } from '../../unified-platform/payments/platform-payments.service';
import { initializePlatformRegistryCache } from '../../module.registry';
import { initializePlatformIntegrationsCache } from '../../platform-integrations/platform-integrations.store';
import { syncStatus } from '../platform-sync.adapter';
import { AtlasPaymentService } from '../../atlas/services/atlas-payment.service';
import { AtlasPaymentController } from '../../atlas/controllers/atlas-payment.controller';
import { BosquePaymentService } from '../../bosque/services/bosque-payment.service';
import { BosquePaymentController } from '../../bosque/controllers/bosque-payment.controller';
import { RenovadaPaymentService } from '../../renovada/services/renovada-payment.service';
import { RenovadaPaymentController } from '../../renovada/controllers/renovada-payment.controller';
import { ZeroGrauPaymentService } from '../../zero-grau/services/zero-grau-payment.service';
import { ZeroGrauPaymentController } from '../../zero-grau/controllers/zero-grau-payment.controller';

const definitions = [['ATLAS', AtlasPaymentService, AtlasPaymentController], ['BOSQUE', BosquePaymentService, BosquePaymentController], ['RENOVADA', RenovadaPaymentService, RenovadaPaymentController], ['ZERO-GRAU', ZeroGrauPaymentService, ZeroGrauPaymentController]] as const;
beforeEach(async () => {
  await initializePlatformRegistryCache({ platform: { findMany: async () => definitions.map(([tag]) => ({ id: tag, tag, ownerUserId: 'owner', acquirer: 'DOM' })) } } as any);
  await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => definitions.map(([tag]) => ({ platform: { tag }, key: 'DOM_TOKEN', url: 'mock-dom-token' })) } } as any);
});
afterEach(async () => {
  await initializePlatformRegistryCache({ platform: { findMany: async () => [] } } as any);
  await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => [] } } as any);
});
function fixture(tag: string, Service: any, Controller: any) {
  const context = { id: tag, tag, ownerUserId: 'owner', acquirer: 'DOM' as const };
  const platform = { ...context, isActive: true, owner: { isActive: true, isPurged: false } };
  const payment = { id: 'local', userId: 'historic-owner', domPaymentId: 'provider', externalPaymentId: 'provider', status: 'COMPLETED', amount: new Prisma.Decimal('12.34'), netAmount: new Prisma.Decimal('11.11'), description: `[TENANT:${tag}]`, pixContent: null, pixQrCode: null, pixExpire: null };
  const p: any = { platform: { findUnique: async () => platform }, transaction: { findFirst: mock(async () => payment) } };
  const reconcile = { reconcilePayment: mock(async () => ({ paymentId: 'provider', status: 'COMPLETED' })) };
  const service = new Service(p, reconcile);
  const controller = tag === 'ZERO-GRAU' ? new Controller(service, reconcile) : new Controller(service, p);
  return { context, platform, payment, p, reconcile, controller, canonical: new PlatformPaymentsService(p, {} as any) };
}
for (const [tag, Service, Controller] of definitions) {
  test(`${tag} legacy payment status and canonical lookup preserve reference, state and historical owner`, async () => {
    const f = fixture(tag, Service, Controller);
    const alias = await f.controller.checkStatus('provider');
    const current = await f.canonical.read(f.context, 'provider');
    expect(alias).toMatchObject({ paymentId: current.paymentId, status: current.status });
    expect(current).toMatchObject({ amountCents: 1234, netAmountCents: 1111 });
    expect(f.payment.userId).toBe('historic-owner');
  });
  test(`${tag} absent or ambiguous payment retains legacy missing response without exposing another product`, async () => {
    const f = fixture(tag, Service, Controller);
    f.payment.description += ' [TENANT:OTHER]';
    expect(await f.controller.checkStatus('provider')).toEqual({ paymentId: 'provider', status: ['BOSQUE', 'RENOVADA'].includes(tag) ? 'PENDING' : 'NOT_FOUND' });
    await expect(f.canonical.read(f.context, 'provider')).rejects.toThrow('Pagamento não encontrado');
    expect(f.reconcile.reconcilePayment).not.toHaveBeenCalled();
  });
  test(`${tag} inactive platform blocks both payment status contracts before querying transaction`, async () => {
    const f = fixture(tag, Service, Controller);
    f.platform.isActive = false;
    await expect(f.controller.checkStatus('provider')).rejects.toThrow('alterado/inativo');
    await expect(f.canonical.read(f.context, 'provider')).rejects.toThrow('alterado/inativo');
    expect(f.p.transaction.findFirst).not.toHaveBeenCalled();
  });
  if (tag === 'ATLAS' || tag === 'ZERO-GRAU') test(`${tag} direct PIX status preserves provider contract and normalizes to same canonical financial state`, async () => {
    const f = fixture(tag, Service, Controller);
    const http = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'paid' })));
    try {
      const direct = await f.controller.checkPixStatusDirect('provider');
      const canonical = await f.canonical.read(f.context, 'provider');
      expect(syncStatus(direct.status)).toBe(canonical.status);
      if (tag === 'ATLAS') expect(http).toHaveBeenCalledTimes(1);
      else expect(f.reconcile.reconcilePayment).toHaveBeenCalledWith('provider', 'historic-owner', 'mock-dom-token');
    } finally { http.mockRestore(); }
  });
}
