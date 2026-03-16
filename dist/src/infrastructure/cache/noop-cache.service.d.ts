import type { ICacheService } from '../../core/services/cache.interface';
export declare class NoopCacheService implements ICacheService {
    delete(key: string): Promise<void>;
}
