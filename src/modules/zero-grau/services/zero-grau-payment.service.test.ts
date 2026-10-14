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
  const prisma = {
    platform: { findUnique: mock(async () => ({ ownerUserId: 'seller', isActive: true, acquirer: 'DOM', owner: { isActive: true, isPurged: false } })) },
    wallet: { findUnique: mock(async () => ({ id: 'wallet' })) },
    transaction: {
      create: mock(async () => ({ id: 'local-card' })),
      update: mock(async () => ({})),
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
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PENDING', domPaymentId: 'dom-card' } }));
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
