import { Injectable } from '@nestjs/common';
import type { ICacheService } from '../../core/services/cache.interface';

@Injectable()
export class NoopCacheService implements ICacheService {
  delete(key: string): Promise<void> {
    void key;
    return Promise.resolve();
  }
}
