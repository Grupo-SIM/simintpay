import { IHashService } from '../../core/services/hash.interface';
export declare class BcryptService implements IHashService {
    private readonly saltRounds;
    hash(plain: string): Promise<string>;
    compare(plain: string, hashed: string): Promise<boolean>;
}
