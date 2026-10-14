import { Injectable } from '@nestjs/common';
import { PlatformSyncPersistenceService } from '../../platform-core/platform-sync-persistence.service';

/** Compatibility facade; scheduler, persistence and wallet updates are shared. */
@Injectable()
export class BosqueSyncService {
  constructor(private readonly syncCore: PlatformSyncPersistenceService) {}
  handleSync() { return this.syncCore.poll('BOSQUE'); }
}
