/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConflictException } from '@nestjs/common';
import {
  BillingContractStatus,
  BillingIntervalType,
  BillingQuantityChangeStatus,
  Prisma,
} from '@prisma/client';
import { BillingService } from './billing.service';

const periodStart = new Date('2026-08-01T00:00:00.000Z');
const periodEnd = new Date('2026-09-01T00:00:00.000Z');

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contract-1',
    userId: 'user-1',
    resourceType: 'WORKSPACE',
    resourceId: 'workspace-1',
    priceKey: 'STANDARD',
    pricingVersion: 1,
    currency: 'BRL',
    baseAmount: new Prisma.Decimal(100),
    unitAmount: new Prisma.Decimal(20),
    quantity: 10,
    pendingQuantity: null,
    minimumQuantity: 1,
    intervalType: BillingIntervalType.MONTH,
    intervalCount: 1,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    status: BillingContractStatus.ACTIVE,
    version: 4,
    externalPlanId: 'plan-1',
    externalSubscriptionId: 'sub-1',
    description: 'Contrato teste',
    ...overrides,
  };
}

function change(overrides: Record<string, unknown> = {}) {
  return {
    id: 'change-1',
    contractId: 'contract-1',
    idempotencyKey: 'idem-1',
    requestHash: '',
    expectedVersion: 4,
    previousQuantity: 10,
    targetQuantity: 8,
    effectiveAt: new Date('2026-08-15T12:00:00.000Z'),
    scheduledFor: periodEnd,
    periodStart,
    periodEnd,
    remainingRatio: new Prisma.Decimal(0),
    previousRecurringAmount: new Prisma.Decimal(300),
    nextRecurringAmount: new Prisma.Decimal(260),
    prorationAmount: new Prisma.Decimal(0),
    status: BillingQuantityChangeStatus.SCHEDULED,
    externalPaymentId: null,
    externalPlanId: null,
    externalSubscriptionId: null,
    failureCode: null,
    failureMessage: null,
    transaction: null,
    createdAt: new Date('2026-08-15T12:00:00.000Z'),
    updatedAt: new Date('2026-08-15T12:00:00.000Z'),
    ...overrides,
  };
}

describe('BillingService.requestQuantityChange', () => {
  it('agenda redução sem crédito e reserva a versão do contrato', async () => {
    const current = contract();
    const created = change();
    const create = jest
      .fn()
      .mockImplementation(({ data }) => Object.assign(created, data));
    const reserveVersion = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      billingContract: { findUnique: jest.fn().mockResolvedValue(current) },
      billingQuantityChange: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockImplementation(() => ({
          ...created,
          contract: { ...current, version: 5, pendingQuantity: 8 },
        })),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockImplementation((callback) =>
        callback({
          billingQuantityChange: { create },
          billingContract: { updateMany: reserveVersion },
        }),
      ),
    } as any;
    const gateway = {} as any;
    const service = new BillingService(prisma, gateway);

    const result = await service.requestQuantityChange('contract-1', 'idem-1', {
      targetQuantity: 8,
      expectedVersion: 4,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'SCHEDULED',
        previousQuantity: 10,
        targetQuantity: 8,
        prorationAmount: '0.00',
        scheduledFor: periodEnd.toISOString(),
      }),
    );
    expect(reserveVersion).toHaveBeenCalledWith({
      where: { id: 'contract-1', version: 4 },
      data: { pendingQuantity: 8, version: { increment: 1 } },
    });
  });

  it('devolve a mesma operação ao repetir uma chave idempotente', async () => {
    const prisma = {
      billingQuantityChange: {
        findUnique: jest.fn(),
      },
    } as any;
    const service = new BillingService(prisma, {} as any);
    const dto = {
      targetQuantity: 8,
      expectedVersion: 4,
    };
    const hash = (service as any).hashRequest({ ...dto, effectiveAt: null });
    prisma.billingQuantityChange.findUnique.mockResolvedValue(
      change({ requestHash: hash }),
    );

    const result = await service.requestQuantityChange(
      'contract-1',
      'idem-1',
      dto,
    );
    expect(result.id).toBe('change-1');
  });

  it('rejeita versão desatualizada antes de cobrar', async () => {
    const prisma = {
      billingContract: {
        findUnique: jest.fn().mockResolvedValue(contract({ version: 5 })),
      },
      billingQuantityChange: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const service = new BillingService(prisma, {} as any);

    await expect(
      service.requestQuantityChange('contract-1', 'idem-2', {
        targetQuantity: 12,
        expectedVersion: 4,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('BillingService.cancelContract', () => {
  it('cancela a recorrência e mantém acesso até o fim do período atual', async () => {
    const current = contract();
    const update = jest.fn().mockImplementation(({ data }) => ({ ...current, ...data }));
    const create = jest.fn();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ domToken: 'dom-token', clientStatus: false, platform: null }),
      },
      billingContract: { findUnique: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn().mockImplementation((callback) => callback({
        billingContract: { update },
        billingContractEvent: { create },
      })),
    } as any;
    const gateway = { cancelSubscription: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new BillingService(prisma, gateway);

    const result = await service.cancelContract('contract-1');

    expect(gateway.cancelSubscription).toHaveBeenCalledWith('dom-token', 'sub-1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { status: BillingContractStatus.CANCELLED, accessEndsAt: periodEnd },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventKey: expect.stringMatching(/^cancel:contract-1:/), type: 'CANCELLED' }),
    }));
    expect(result.currentPeriodEnd).toBe(periodEnd.toISOString());
  });

  it('reativa uma recorrência cancelada', async () => {
    const current = contract({
      status: BillingContractStatus.CANCELLED,
      accessEndsAt: periodEnd,
    });
    const update = jest.fn().mockImplementation(({ data }) => ({ ...current, ...data }));
    const create = jest.fn();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ domToken: 'dom-token', clientStatus: false, platform: null }),
      },
      billingContract: { findUnique: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn().mockImplementation((callback) => callback({
        billingContract: { update },
        billingContractEvent: { create },
      })),
    } as any;
    const gateway = { reactivateSubscription: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new BillingService(prisma, gateway);

    const result = await service.reactivateContract('contract-1');

    expect(gateway.reactivateSubscription).toHaveBeenCalledWith('dom-token', 'sub-1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { status: BillingContractStatus.ACTIVE, accessEndsAt: null },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventKey: expect.stringMatching(/^reactivate:contract-1:/), type: 'REACTIVATED' }),
    }));
    expect(result.status).toBe(BillingContractStatus.ACTIVE);
  });

  it('emite um novo evento ao cancelar após reativar', async () => {
    const current = contract();
    const update = jest.fn(({ data }) => Object.assign(current, data));
    const create = jest.fn();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ domToken: 'dom-token', clientStatus: false, platform: null }),
      },
      billingContract: { findUnique: jest.fn().mockImplementation(() => current) },
      $transaction: jest.fn().mockImplementation((callback) => callback({
        billingContract: { update },
        billingContractEvent: { create },
      })),
    } as any;
    const gateway = {
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      reactivateSubscription: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new BillingService(prisma, gateway);

    await service.cancelContract('contract-1');
    await service.reactivateContract('contract-1');
    await service.cancelContract('contract-1');

    const eventKeys = create.mock.calls.map(([{ data }]) => data.eventKey);
    expect(eventKeys).toHaveLength(3);
    expect(new Set(eventKeys).size).toBe(3);
    expect(create.mock.calls.map(([{ data }]) => data.type)).toEqual([
      'CANCELLED',
      'REACTIVATED',
      'CANCELLED',
    ]);
  });
});

describe('BillingService.applyWorkspacePaymentEvent', () => {
  it('etiqueta a transação com a plataforma do contrato', async () => {
    const current = contract({ metadata: { platformTag: 'TERON' } });
    const upsert = jest.fn();
    const prisma = {
      billingContract: { findUnique: jest.fn().mockResolvedValue(current) },
      billingContractEvent: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((callback) =>
        callback({
          billingContractEvent: { create: jest.fn() },
          transaction: { upsert },
          billingContract: { update: jest.fn() },
        }),
      ),
    } as any;
    const service = new BillingService(prisma, {} as any);

    await service.applyWorkspacePaymentEvent({
      subscriptionId: 'sub-1',
      eventKey: 'payment:1',
      event: 'PAID',
      paymentId: 'payment-1',
      amount: 300,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          description: 'Contrato teste [TENANT:TERON]',
        }),
        create: expect.objectContaining({
          description: 'Contrato teste [TENANT:TERON]',
        }),
      }),
    );
  });
});

describe('BillingService period refresh', () => {
  it('avança um período vencido somente após validar o valor recorrente na DOM', async () => {
    const stale = contract({
      currentPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
    });
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          domToken: 'dom-token',
          clientStatus: false,
          platform: null,
        }),
      },
      billingContract: { update },
    } as any;
    const gateway = {
      getSubscriptionBillingSnapshot: jest.fn().mockResolvedValue({
        id: 'sub-1',
        status: 'active',
        recurringAmount: 300,
        frequencyType: 'MONTH',
        frequency: 1,
        nextInvoiceAt: '2026-09-01T00:00:00.000Z',
      }),
    } as any;
    const service = new BillingService(prisma, gateway);

    const refreshed = await (service as any).refreshPeriodIfNeeded(
      stale,
      new Date('2026-08-15T12:00:00.000Z'),
    );

    expect(refreshed.currentPeriodStart.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(refreshed.currentPeriodEnd.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: {
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
  });
});
