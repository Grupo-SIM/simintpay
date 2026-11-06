import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { walletAmounts } from '../../../modules/wallet-ledger/wallet-balance';
import { isMasterAdminUser } from '../../../shared/utils/is-master-admin.util';

interface MeUser {
  id: string;
  name: string;
  email: string;
  cpf?: string | null;
  cnpj?: string | null;
  role: string;
  clientStatus?: string | null;
  isAffiliate?: boolean | null;
  affiliateCode?: string | null;
  createdAt: Date;
  platform?: { tag: string; name: string } | null;
  ownedPlatforms?: {
    id: string;
    tag: string;
    name: string;
    isActive: boolean;
  }[];
}

@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { userId: string }): Promise<{
    id: string;
    name: string;
    email: string;
    cpf: string | null;
    cnpj: string | null;
    role: string;
    isAdmin: boolean;
    /** Admin master (taxas globais, etc.) — derivado de role + tenant slug/nome. */
    isMasterAdmin: boolean;
    /** Cliente SimintPay (auto-cadastrado). */
    isClient: boolean;
    clientStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
    isAffiliate: boolean;
    affiliateCode: string | null;
    platform: { tag: string; name: string } | null;
    ownedPlatforms: {
      id: string;
      tag: string;
      name: string;
      isActive: boolean;
    }[];
    walletScope: 'owner' | 'shared-owner';
    wallet: {
      balance: number;
      lockedBalance: number;
      availableBalance: number;
      netBalance: number;
    };
    createdAt: string;
  }> {
    const user = (await this.users.findById(input.userId)) as MeUser | null;
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: user.id },
    });

    if (!wallet) {
      throw new UnauthorizedException('Wallet não encontrada');
    }

    const ownedPlatforms = (user.ownedPlatforms ?? []).map(
      (platform: {
        id: string;
        tag: string;
        name: string;
        isActive: boolean;
      }) => ({
        id: platform.id,
        tag: platform.tag,
        name: platform.name,
        isActive: platform.isActive,
      }),
    );
    const sharedWallet = ownedPlatforms.length > 1;

    // Fonte única de saldo: a mesma da validação do saque. Vale para plataforma própria, coprodução e afiliado.
    const current = walletAmounts(wallet);
    const walletResp = {
      balance: current.balance,
      lockedBalance: current.lockedBalance,
      availableBalance: current.available,
      netBalance: current.available,
    };

    const tenant =
      user.platform != null
        ? { tag: user.platform.tag, name: user.platform.name }
        : null;

    const master = isMasterAdminUser({
      role: user.role,
      email: user.email,
      platform: user.platform,
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      cpf: user.cpf ?? null,
      cnpj: user.cnpj ?? null,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      isMasterAdmin: master,
      isClient: user.clientStatus != null,
      clientStatus: (user.clientStatus ?? null) as
        | 'PENDING'
        | 'APPROVED'
        | 'REJECTED'
        | null,
      isAffiliate: user.isAffiliate ?? false,
      affiliateCode: user.affiliateCode ?? null,
      platform: tenant,
      ownedPlatforms,
      walletScope: sharedWallet ? 'shared-owner' : 'owner',
      wallet: walletResp,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
