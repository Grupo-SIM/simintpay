import { describe, it, expect, mock } from 'bun:test';
import { PlatformSyncService } from './platform-sync.service';
import { PlatformEventsService } from './platform-events.service';

const context = { id: 'p1', tag: 'CLIENT', ownerUserId: 'owner', acquirer: 'DOM' as const };

describe('PlatformSyncService', () => {
  it('coalesces concurrent requests for same platform and isolates query scope', async () => {
    let release!: (value: unknown[]) => void;
    const pending = new Promise<unknown[]>(resolve => { release = resolve; });
    const prisma = {
      platformIntegration: { findUnique: mock().mockResolvedValue({ encryptedValue: 'unused' }) },
      transaction: { findMany: mock().mockReturnValue(pending) },
    };
    // Corporate handler exercises same coalescing without secrets/network.
    const corporate = { ...context, tag: 'ATLAS' };
    const modules = { get: mock().mockReturnValue({ handleSync: mock().mockReturnValue(pending) }) };
    const service = new PlatformSyncService(prisma as never, {} as never, modules as never, new PlatformEventsService(), {} as never);
    const first = service.sync(corporate);
    expect(service.sync(corporate)).toBe(first);
    expect(modules.get).toHaveBeenCalledTimes(1);
    release([]);
    await first;
    await service.sync(corporate);
    expect(modules.get).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported acquirer without silently selecting DOM', async () => {
    const modules = { get: mock() };
    const service = new PlatformSyncService({} as never, {} as never, modules as never, new PlatformEventsService(), {} as never);
    await expect(service.sync({ ...context, acquirer: 'FRENDZ' })).rejects.toMatchObject({ status: 422 });
    expect(modules.get).not.toHaveBeenCalled();
  });
});
