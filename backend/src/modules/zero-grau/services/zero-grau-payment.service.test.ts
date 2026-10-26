import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
import { ZeroGrauPaymentService } from './zero-grau-payment.service';

beforeAll(async () => {
  await initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [] } } as never);
});

const card = {
  price: 10, document: '52998224725', document_type: 'CPF', email: 'customer@example.com',
  name: 'Maria Silva', holder_name: 'Maria Silva', token: 'local-card-token',
  bin: '424242', brand: 'visa', installments: 1,
};

function fixture(gatewayStatus: string, localStatus: string) {
  let stored: any;
  const prisma = {
    financialPolicyRevision: { findMany: mock(async () => []) },
    platform: { findUnique: mock(async () => ({ ownerUserId: 'seller', isActive: true, acquirer: 'DOM', owner: { isActive: true, isPurged: false } })) },
    wallet: { findUnique: mock(async () => ({ id: 'wallet' })), upsert: mock(async () => ({ id: 'wallet' })) },
    transaction: {
      create: mock(async ({ data }: any) => { stored = { id: 'local-card', ...data }; return stored; }),
      update: mock(async ({ data }: any) => { stored = { ...stored, ...data }; return stored; }),
      updateMany: mock(async ({ where, data }: any) => {
        if (stored.status !== where.status) return { count: 0 };
        stored = { ...stored, ...data }; return { count: 1 };
      }),
    },
  };
  const reconcilePayment = mock(async () => ({ paymentId: 'dom-card', status: localStatus }));
  const service = new ZeroGrauPaymentService(prisma as never, { reconcilePayment } as never);
  // Isolate the gateway transport: no real charge or database connection.
  Object.assign(service, { createDomPagamentosCreditCard: mock(async () => ({ id: 'dom-card', status: gatewayStatus })) });
  return { service, prisma, reconcilePayment };
}

describe('Zero Grau card settlement', () => {
  test('reports approval only after settling the SimIntPay transaction', async () => {
    const { service, prisma, reconcilePayment } = fixture('approved', 'COMPLETED');
    const result = await service.createPaymentCreditCard('seller', card);
    expect(result).toMatchObject({ status: 'COMPLETED', paymentId: 'dom-card', transactionId: 'local-card' });
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({ where: { id: 'local-card', status: 'DRAFT' }, data: { status: 'PENDING' } });
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({ data: { domPaymentId: 'dom-card', externalPaymentId: 'dom-card' } }));
    expect(reconcilePayment.mock.calls[0]?.slice(0, 2)).toEqual(['dom-card', 'seller']);
  });

  test('preserves pending while asynchronous authorization is outstanding', async () => {
    const { service, reconcilePayment } = fixture('pending', 'PENDING');
    expect((await service.createPaymentCreditCard('seller', card)).status).toBe('PENDING');
    expect(reconcilePayment).not.toHaveBeenCalled();
  });

  test('reports persisted rejection instead of masking it as pending', async () => {
    const { service } = fixture('not_authorized', 'FAILED');
    expect((await service.createPaymentCreditCard('seller', card)).status).toBe('FAILED');
  });

  test('does not report approval when local settlement remains pending', async () => {
    const { service } = fixture('approved', 'PENDING');
    expect((await service.createPaymentCreditCard('seller', card)).status).toBe('PENDING');
  });

  test('retains a charged payment reference if settlement fails so polling can retry', async () => {
    const { service, reconcilePayment } = fixture('approved', 'COMPLETED');
    reconcilePayment.mockImplementation(async () => { throw new Error('local settlement unavailable'); });
    expect(await service.createPaymentCreditCard('seller', card)).toMatchObject({ paymentId: 'dom-card', status: 'PENDING' });
  });
});
