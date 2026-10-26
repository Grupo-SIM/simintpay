import { Wallet } from '@prisma/client';

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

export interface IWalletRepository {
  findByUserId(userId: string): Promise<Wallet | null>;
  createForUser(userId: string): Promise<Wallet>;
}
