export declare const CACHE_SERVICE: unique symbol;
export interface ICacheService {
    delete(key: string): Promise<void>;
}
