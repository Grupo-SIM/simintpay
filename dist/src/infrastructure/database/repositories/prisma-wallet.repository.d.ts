import { Wallet } from '@prisma/client';
import { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
export declare class PrismaWalletRepository implements IWalletRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findByUserId(userId: string): Promise<Wallet | null>;
    createForUser(userId: string): Promise<Wallet>;
}
