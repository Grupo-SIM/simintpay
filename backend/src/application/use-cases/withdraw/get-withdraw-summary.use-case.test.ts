import { expect, test } from 'bun:test';
import { GetWithdrawSummaryUseCase } from './get-withdraw-summary.use-case';
import { initializePlatformRegistryCache } from '../../../modules/module.registry';
for (const tag of ['GLOBAL', 'RENOVADA', 'BOSQUE']) {
  test(`${tag} summary subtracts wallet reserve once, ignores unrelated approved withdrawals`, async () => {
    const platform: any = { id: 'product', tag, ownerUserId: 'owner', acquirer: 'DOM' };
    await initializePlatformRegistryCache({ platform: { findMany: async () => [platform] } } as never);
    try {
      const service = new GetWithdrawSummaryUseCase({ findById: async () => ({ id: 'owner', platform }) } as never,
        { findByUserId: async () => ({ id: 'w', userId: 'owner', balance: 100, lockedBalance: 20 }) } as never, {} as never,
        { withdrawRequest: { findMany: async () => [{ status: 'PENDING', grossAmount: 30, amount: 28 }, { status: 'APPROVED', grossAmount: 40, amount: 38 }] } } as never);
      const result = await service.execute('owner', tag);
      expect(result.availableBalance).toBe(80);
      expect(result.lockedBalance).toBe(20);
    } finally { await initializePlatformRegistryCache({ platform: { findMany: async () => [] } } as never); }
  });
}
