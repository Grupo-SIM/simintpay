import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';

import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string }): Promise<{
    id: string;
    name: string;
    email: string;
    role: string;
    wallet: {
      balance: number;
      lockedBalance: number;
      availableBalance: number;
      netBalance: number;
    };
    createdAt: string;
  }> {
    const user = await this.users.findById(input.userId);
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const wallet = await this.wallets.findByUserId(user.id);
    if (!wallet) {
      throw new UnauthorizedException('Wallet não encontrada');
    }

    const balance = Number(wallet.balance);
    const lockedBalance = Number(wallet.lockedBalance);
    const availableBalance = balance - lockedBalance;

    const netBalance = availableBalance;

    if (user.domToken) {
      try {
        const domMe = await this.gateway.me(user.domToken);
        if (domMe.name || domMe.email) {
          return {
            id: user.id,
            name: domMe.name ?? user.name,
            email: domMe.email ?? user.email,
            role: user.role,
            wallet: {
              balance,
              lockedBalance,
              availableBalance,
              netBalance,
            },
            createdAt: user.createdAt.toISOString(),
          };
        }
      } catch {
        // ignore enrichment failure
      }
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      wallet: {
        balance,
        lockedBalance,
        availableBalance,
        netBalance,
      },
      createdAt: user.createdAt.toISOString(),
    };
  }
}
