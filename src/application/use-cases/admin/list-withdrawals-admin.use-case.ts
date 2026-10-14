import { Injectable } from '@nestjs/common';
import { WithdrawStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

/** Módulos em que o saque trava saldo na carteira principal (User.wallet), não só em ExternalPlatformWallet. */
const USE_MAIN_WALLET_FOR_CAPITAL = new Set([
  'renovada',
  'bosque',
  'revalida',
  'atlas',
  'frendz',
  'comunidade',
  'return-bet',
]);

type WalletRow = { balance: unknown; lockedBalance: unknown } | null;

/** Saldo já reflete regras da carteira; aqui só expomos disponível = balance − locked (sem fator de liquidez extra). */
function saldoDisponivel(balance: number, locked: number): number {
  return Number(Math.max(0, balance - locked).toFixed(2));
}

/**
 * Capital atualizado após bloqueios, por plataforma do saque:
 * - renovada/bosque/…: User.wallet (onde o lock do saque é aplicado);
 * - ebook/pagatg/…: ExternalPlatformUser + wallet da mesma plataforma do saque, com fallback na carteira principal.
 */
function resolveSaldoAtualCliente(input: {
  platformOnWithdraw: string | null;
  tenantSlug: string | null;
  mainWallet: WalletRow;
  externalPlatformUsers: Array<{
    platform: string;
    wallet: WalletRow;
  }>;
}): number {
  const platformSlug = (input.platformOnWithdraw ?? input.tenantSlug ?? null)?.toLowerCase() ?? null;
  const slugKey = platformSlug ?? '';

  if (platformSlug && USE_MAIN_WALLET_FOR_CAPITAL.has(slugKey) && input.mainWallet) {
    return saldoDisponivel(
      Number(input.mainWallet.balance),
      Number(input.mainWallet.lockedBalance),
    );
  }

  if (platformSlug) {
    const ext = input.externalPlatformUsers.find(
      (u) => u.platform.toLowerCase() === platformSlug,
    );
    if (ext?.wallet) {
      return saldoDisponivel(
        Number(ext.wallet.balance),
        Number(ext.wallet.lockedBalance),
      );
    }
  }

  if (input.mainWallet) {
    return saldoDisponivel(
      Number(input.mainWallet.balance),
      Number(input.mainWallet.lockedBalance),
    );
  }

  return 0;
}

function mapWithdrawStatusToPt(
  status: WithdrawStatus,
): 'PENDENTE' | 'APROVADA' | 'RECUSADA' {
  switch (status) {
    case WithdrawStatus.PENDING:
      return 'PENDENTE';
    case WithdrawStatus.APPROVED:
    case WithdrawStatus.COMPLETED:
      return 'APROVADA';
    case WithdrawStatus.REJECTED:
      return 'RECUSADA';
    default:
      return 'PENDENTE';
  }
}

@Injectable()
export class ListWithdrawalsAdminUseCase {
  constructor(private readonly prisma: PrismaService) { }

  async execute(input: {
    page: number;
    pageSize: number;
    status?: WithdrawStatus;
    moduleSlug?: string;
    userId?: string;
    search?: string;
  }) {
    const skip = (input.page - 1) * input.pageSize;

    // Each OR group is collected separately to avoid key collision when spreading
    const andConditions: object[] = [];

    if (input.moduleSlug) {
      // Match pelo campo platform gravado na criação, ou fallback para platform do usuário
      andConditions.push({
        OR: [
          { platform: { equals: input.moduleSlug, mode: 'insensitive' as const } },
          { user: { platform: { tag: { equals: input.moduleSlug, mode: 'insensitive' as const } } } },
        ],
      });
    }

    if (input.search) {
      andConditions.push({
        OR: [
          { id: { contains: input.search, mode: 'insensitive' as const } },
          { user: { name: { contains: input.search, mode: 'insensitive' as const } } },
          { user: { email: { contains: input.search, mode: 'insensitive' as const } } },
          { user: { returnBetAccount: { name: { contains: input.search, mode: 'insensitive' as const } } } },
          { user: { returnBetAccount: { email: { contains: input.search, mode: 'insensitive' as const } } } },
          { user: { returnBetAccount: { document: { contains: input.search } } } },
        ],
      });
    }

    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where,
        skip,
        take: input.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              platform: { select: { name: true, tag: true } },
              wallet: { select: { balance: true, lockedBalance: true } },
              externalPlatformUsers: {
                include: { wallet: true },
              },
              returnBetAccount: {
                select: { name: true, email: true },
              },
            },
          },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);

    return {
      data: items.map((w) => {
        const platformStored =
          (w as { platform?: string | null }).platform?.trim() || null;
        return {
        id: w.id,
        valor: Number(w.grossAmount),
        valorLiquido: Number(w.amount),
        status: mapWithdrawStatusToPt(w.status),
        metodo: 'PIX',
        descricao: 'Saque SimPay',
        chavePix: w.pixKey,
        comprovante: w.receiptImage ?? null,
        comprovanteVisivel: w.comprovanteVisivel,
        observacao: w.rejectionReason ?? null,
        taxas: {
          total: Number(w.fee),
        },
        cliente: {
          id: w.user.id,
          nome: w.user.returnBetAccount?.name ?? w.user.name,
          email: w.user.returnBetAccount?.email ?? w.user.email,
          modulo: (() => {
            // Prioridade: campo platform gravado na criação > platform do usuário
            if (platformStored) {
              return { nome: platformStored, slug: platformStored.toLowerCase() };
            }
            if (w.user.platform) {
              return { nome: w.user.platform.name, slug: w.user.platform.tag };
            }
            return null;
          })(),
          saldoAtual: resolveSaldoAtualCliente({
            platformOnWithdraw: platformStored,
            tenantSlug: w.user.platform?.tag ?? null,
            mainWallet: w.user.wallet ?? null,
            externalPlatformUsers: w.user.externalPlatformUsers,
          }),
        },
        criadoEm: w.createdAt.toISOString(),
        atualizadoEm: w.updatedAt.toISOString(),
      };
      }),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }
}
