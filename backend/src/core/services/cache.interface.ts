export const CACHE_SERVICE = Symbol('CACHE_SERVICE');

export interface ICacheService {
  delete(key: string): Promise<void>;
}
