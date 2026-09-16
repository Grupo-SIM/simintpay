import { ConflictException } from '@nestjs/common';
import { IntegrationFinanceService } from './integration-finance.service';
import { ZeroGrauConfig } from '../zero-grau/zero-grau.config';

describe('IntegrationFinanceService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('quotes positive values without applying the legacy withdrawal minimum', () => {
    jest.spyOn(ZeroGrauConfig.saque, 'taxaFixa', 'get').mockReturnValue(2);
    jest.spyOn(ZeroGrauConfig.saque, 'taxaPercentual', 'get').mockReturnValue(0.01);
    const service = new IntegrationFinanceService({} as never);

    expect(service.quote(10_000)).toEqual({ feeCents: 300, grossAmountCents: 10_000, netAmountCents: 9_700 });
  });

  it('rejects an idempotency key already owned by another merchant', async () => {
    const prisma = {
      withdrawRequest: { findUnique: jest.fn().mockResolvedValue({ userId: 'merchant-user-2' }) },
    };
    const service = new IntegrationFinanceService(prisma as never);
    jest.spyOn(service, 'merchant').mockResolvedValue({ userId: 'merchant-user-1' } as never);

    await expect(service.requestWithdrawal('sim-delivery', 'company-1', {
      grossAmountCents: 10_000,
      pixKey: 'pix@example.com',
      requestId: 'request-1',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not partially move reconciliation batches containing conflicts', async () => {
    const transactions = [
      { amount: 100, domPaymentId: 'payment-1', externalPaymentId: null, id: 'transaction-1', netAmount: 90, status: 'COMPLETED', userId: 'legacy-user' },
      null,
    ];
    const prisma = {
      $transaction: jest.fn(),
      integrationMerchant: { findUnique: jest.fn().mockResolvedValue(null) },
      transaction: { findFirst: jest.fn().mockImplementation(() => Promise.resolve(transactions.shift())) },
    };
    const service = new IntegrationFinanceService(prisma as never);
    jest.spyOn(service, 'merchant').mockResolvedValue({ userId: 'merchant-user-1' } as never);

    await expect(service.reconcilePayments('sim-delivery', 'company-1', ['payment-1', 'missing'], false)).resolves.toEqual({
      attributed: 0,
      conflicts: ['missing'],
      creditedCents: 0,
      dryRun: false,
      skipped: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
