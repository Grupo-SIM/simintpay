import {
  BillingContractStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PlatformReportingService } from './platform-reporting.service';

function createPrisma(overrides: Record<string, unknown> = {}) {
  return {
    communityLinkBinding: { findMany: jest.fn().mockResolvedValue([]) },
    subscriptionLinkOrder: { findMany: jest.fn().mockResolvedValue([]) },
    billingContract: { findMany: jest.fn().mockResolvedValue([]) },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  } as any;
}

function billingContract(
  id: string,
  customerId: string,
  status: BillingContractStatus,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    externalSubscriptionId: `subscription-${id}`,
    metadata: { platformTag: 'TERON', reportingCustomerId: customerId },
    status,
    graceEndsAt: null,
    accessEndsAt: null,
    createdAt: new Date(`2026-0${id.length}-01T00:00:00.000Z`),
    ...overrides,
  };
}

describe('PlatformReportingService', () => {
  it('deduplica workspaces e conta somente contratos com acesso vigente', async () => {
    const prisma = createPrisma({
      billingContract: {
        findMany: jest.fn().mockResolvedValue([
          billingContract('1', 'account-1', BillingContractStatus.ACTIVE),
          billingContract('2', 'account-1', BillingContractStatus.CANCELLED, {
            accessEndsAt: new Date('2999-01-01T00:00:00.000Z'),
          }),
          billingContract('3', 'account-2', BillingContractStatus.PAST_DUE, {
            graceEndsAt: new Date('2999-01-01T00:00:00.000Z'),
          }),
          billingContract('4', 'account-3', BillingContractStatus.PAST_DUE, {
            graceEndsAt: new Date('2000-01-01T00:00:00.000Z'),
          }),
          billingContract('5', 'account-4', BillingContractStatus.CANCELLED, {
            accessEndsAt: new Date('2000-01-01T00:00:00.000Z'),
          }),
        ]),
      },
    });
    const service = new PlatformReportingService(prisma);

    await expect(
      service.getCommunityCustomerStats('TERON', 'community-1'),
    ).resolves.toEqual({ totalContas: 4, sellersAtivos: 2 });
    expect(prisma.billingContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { metadata: { path: ['platformTag'], equals: 'TERON' } },
      }),
    );
  });

  it('usa teronAccountId legado e dados da transação inicial no modal', async () => {
    const prisma = createPrisma({
      billingContract: {
        findMany: jest.fn().mockResolvedValue([
          billingContract('1', 'ignored', BillingContractStatus.ACTIVE, {
            metadata: { platformTag: 'TERON', teronAccountId: 'legacy-account' },
          }),
          billingContract('2', 'ignored', BillingContractStatus.ACTIVE, {
            metadata: { platformTag: 'TERON', teronAccountId: 'legacy-account' },
          }),
        ]),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            externalPaymentId: 'subscription-1',
            customerName: 'Cliente Teron',
            customerEmail: 'cliente@teron.app',
            customerDocument: '12345678901',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      },
    });
    const service = new PlatformReportingService(prisma);

    const result = await service.listCommunityCustomers(
      'TERON',
      'community-1',
      { page: 1, pageSize: 20, onlyActive: true },
    );

    expect(result.total).toBe(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        name: 'Cliente Teron',
        email: 'cliente@teron.app',
        cpf: '12345678901',
        isRegisteredInSimIntPay: true,
      }),
    );
  });

  it('mantém clientes de links e deduplica pedidos pela identidade', async () => {
    const prisma = createPrisma({
      communityLinkBinding: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ subscriptionLinkId: 'link-1' }]),
      },
      subscriptionLinkOrder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'order-1',
            customerName: 'Maria',
            customerEmail: 'maria@example.com',
            customerDocument: '111.222.333-44',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            status: 'paid',
          },
          {
            id: 'order-2',
            customerName: 'Maria',
            customerEmail: 'MARIA@example.com',
            customerDocument: '11122233344',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            status: 'cancelled',
          },
        ]),
      },
    });
    const service = new PlatformReportingService(prisma);

    await expect(
      service.getCommunityCustomerStats('COMUNIDADE', 'community-1'),
    ).resolves.toEqual({ totalContas: 1, sellersAtivos: 1 });
  });

  it('distribui transações etiquetadas mesmo sem links', async () => {
    const prisma = createPrisma({
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            description: 'Teron workspace [TENANT:TERON]',
            paymentMethod: PaymentMethod.CREDIT_CARD,
            amount: new Prisma.Decimal(10),
          },
          {
            description: 'Teron workspace [TENANT:TERON]',
            paymentMethod: PaymentMethod.CREDIT_CARD,
            amount: new Prisma.Decimal(20),
          },
        ]),
      },
    });
    const service = new PlatformReportingService(prisma);

    await expect(
      service.getCommunityPaymentDistribution('TERON', 'community-1', {}),
    ).resolves.toEqual({
      total: 2,
      items: [
        {
          codigo: 'CREDIT_CARD',
          nome: 'Crédito',
          quantidade: 2,
          valor: 30,
          percentual: 100,
        },
      ],
    });
  });

  it('remove pedido sintético quando existe transação correspondente', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([
      {
        id: 'order-1',
        paymentMethod: PaymentMethod.PIX,
        amountCharged: new Prisma.Decimal(50),
      },
    ]);
    const transactionFindMany = jest.fn().mockResolvedValue([
      {
        description: 'Assinatura subOrder=order-1 [TENANT:COMUNIDADE]',
        paymentMethod: PaymentMethod.PIX,
        amount: new Prisma.Decimal(50),
      },
    ]);
    const prisma = createPrisma({
      communityLinkBinding: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ subscriptionLinkId: 'link-1' }]),
      },
      subscriptionLinkOrder: { findMany: orderFindMany },
      transaction: { findMany: transactionFindMany },
    });
    const service = new PlatformReportingService(prisma);
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-01-31T23:59:59.999Z');

    const result = await service.getCommunityPaymentDistribution(
      'COMUNIDADE',
      'community-1',
      { start, end },
    );

    expect(result.total).toBe(1);
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { gte: start, lte: end } }),
      }),
    );
    expect(transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end },
        }),
      }),
    );
  });
});
