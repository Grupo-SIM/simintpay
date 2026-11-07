import { ConflictException } from '@nestjs/common';
import { IntegrationFinanceService } from './integration-finance.service';
import * as platformTaxas from '../platform-taxas/platform-taxas.store';

describe('IntegrationFinanceService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('quotes positive values without applying the legacy withdrawal minimum', () => {
    jest.spyOn(platformTaxas, 'getPlatformTaxaEffective').mockReturnValue(0.01);
    jest.spyOn(platformTaxas, 'resolveWithdrawalFixedFee').mockReturnValue(2);
    const service = new IntegrationFinanceService({} as never);

    expect(service.quote(10_000)).toEqual({
      feeCents: 300,
      grossAmountCents: 10_000,
      netAmountCents: 9_700,
    });
  });

  it('rejects an idempotency key already owned by another merchant', async () => {
    const prisma = {
      withdrawRequest: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'merchant-user-2' }),
      },
    };
    const service = new IntegrationFinanceService(prisma as never);
    jest
      .spyOn(service, 'merchant')
      .mockResolvedValue({ userId: 'merchant-user-1' } as never);

    await expect(
      service.requestWithdrawal('sim-delivery', 'company-1', {
        grossAmountCents: 10_000,
        pixKey: 'pix@example.com',
        requestId: 'request-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a document belonging to another account without changing linked merchant', async () => {
    const existing = {
      id: 'merchant-manual',
      integrationKey: 'sim-delivery_zero-grau',
      externalMerchantId: 'company-1',
      userId: 'legacy-user',
    };
    const userUpdate = jest.fn().mockResolvedValue({});
    const merchantUpdate = jest.fn().mockResolvedValue({
      ...existing,
      cnpj: '10802530000107',
      legalName: 'Zero Grau',
    });
    const tx = {
      integrationMerchant: { update: merchantUpdate },
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.id
                ? { id: 'legacy-user', isActive: true, isPurged: false }
                : { id: 'duplicate-integration-user' },
            ),
          ),
        update: userUpdate,
      },
    };
    const prisma = {
      platformIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            url: 'sim-delivery_zero-grau',
            platform: { id: 'p', tag: 'SHOP', acquirer: 'DOM' },
          },
        ]),
      },
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
      integrationMerchant: {
        findUnique: jest.fn().mockResolvedValue(existing),
      },
    };
    const service = new IntegrationFinanceService(prisma as never);

    await expect(
      service.provision('sim-delivery_zero-grau', 'company-1', {
        cnpj: '10.802.530/0001-07',
        legalName: 'Zero Grau',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(merchantUpdate).not.toHaveBeenCalled();
  });

  it('never moves historical ownership during merchant reconciliation', async () => {
    const transactions = [
      {
        amount: 100,
        domPaymentId: 'payment-1',
        externalPaymentId: null,
        id: 'transaction-1',
        netAmount: 90,
        status: 'COMPLETED',
        userId: 'legacy-user',
      },
      null,
    ];
    const prisma = {
      platformIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            url: 'sim-delivery,sim-delivery_zero-grau',
            platform: { id: 'p', tag: 'SHOP', acquirer: 'DOM' },
          },
        ]),
      },
      $transaction: jest.fn(),
      integrationMerchant: { findUnique: jest.fn().mockResolvedValue(null) },
      transaction: {
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve(transactions.shift())),
      },
    };
    const service = new IntegrationFinanceService(prisma as never);
    jest
      .spyOn(service, 'merchant')
      .mockResolvedValue({ userId: 'merchant-user-1' } as never);

    await expect(
      service.reconcilePayments(
        'sim-delivery',
        'company-1',
        ['payment-1', 'missing'],
        false,
      ),
    ).resolves.toEqual({
      attributed: 0,
      conflicts: ['payment-1', 'missing'],
      creditedCents: 0,
      dryRun: false,
      skipped: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips payments already owned by the selected company merchant', async () => {
    const prisma = {
      platformIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            url: 'sim-delivery,sim-delivery_zero-grau',
            platform: { id: 'p', tag: 'SHOP', acquirer: 'DOM' },
          },
        ]),
      },
      integrationMerchant: { findUnique: jest.fn() },
      transaction: {
        findFirst: jest.fn().mockResolvedValue({
          userId: 'legacy-user',
          description: '[TENANT:SHOP]',
          platformTag: 'SHOP',
        }),
      },
    };
    const service = new IntegrationFinanceService(prisma as never);
    jest
      .spyOn(service, 'merchant')
      .mockResolvedValue({ userId: 'legacy-user' } as never);

    await expect(
      service.reconcilePayments(
        'sim-delivery_zero-grau',
        'company-1',
        ['payment-1'],
        false,
      ),
    ).resolves.toEqual({
      attributed: 0,
      conflicts: [],
      creditedCents: 0,
      dryRun: false,
      skipped: 1,
    });
  });
});
