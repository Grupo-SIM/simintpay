import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PlatformSyncService } from '../../modules/platform-core/platform-sync.service';

/** Compatibility facade. PlatformSyncService owns the only platform sync schedule. */
@Injectable()
export class SyncDomTransactionsCron {
  constructor(private readonly modules: ModuleRef) {}

  handleSync() {
    return this.modules.get(PlatformSyncService, { strict: false }).scheduled();
  }
}
