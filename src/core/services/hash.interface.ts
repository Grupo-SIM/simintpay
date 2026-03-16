export const HASH_SERVICE = Symbol('HASH_SERVICE');

export interface IHashService {
  hash(plain: string): Promise<string>;
  compare(plain: string, hashed: string): Promise<boolean>;
}
