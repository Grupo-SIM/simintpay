import 'reflect-metadata';
import { describe, expect, mock, test } from 'bun:test';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { SyncDomTransactionsCron } from './sync-dom-transactions.cron';
import { PlatformSyncService } from '../../modules/platform-core/platform-sync.service';

describe('Legacy global sync facade', () => {
  test('delegates directly to shared configured-platform scheduler without a second timer', async () => {
    const scheduled = mock(async () => undefined);
    const get = mock(() => ({ scheduled }));
    const legacy = new SyncDomTransactionsCron({ get } as never);
    await legacy.handleSync();
    expect(get).toHaveBeenCalledWith(PlatformSyncService, { strict: false });
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, legacy.handleSync)).toBeUndefined();
  });
});
