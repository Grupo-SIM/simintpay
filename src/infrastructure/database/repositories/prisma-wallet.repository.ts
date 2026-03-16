import { Injectable } from '@nestjs/common';
import { Wallet } from '@prisma/client';
import { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaWalletRepository implements IWalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({ where: { userId } });
  }

  async createForUser(userId: string): Promise<Wallet> {
    return this.prisma.wallet.create({ data: { userId } });
  }
}
