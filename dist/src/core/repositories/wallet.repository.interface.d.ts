import { Wallet } from '@prisma/client';
export declare const WALLET_REPOSITORY: unique symbol;
export interface IWalletRepository {
    findByUserId(userId: string): Promise<Wallet | null>;
    createForUser(userId: string): Promise<Wallet>;
}
