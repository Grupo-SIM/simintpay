import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { getWalletBalance } from '../../../modules/wallet-ledger/wallet-balance';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

const r2 = (n: number) => Number(n.toFixed(2));

@Injectable()
export class GetWalletCompositionUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { email?: string; userId?: string }) {
    const email = input.email?.trim();
    const userId = input.userId?.trim();
    if (!email && !userId) {
      throw new BadRequestException('Informe query email ou userId');
    }

    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          include: { platform: true },
        })
      : await this.prisma.user.findUnique({
          where: { email: email!.toLowerCase() },
          include: { platform: true },
        });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: user.id },
    });
    if (!wallet) {
      throw new NotFoundException('Wallet não encontrada');
    }

    const balance = await getWalletBalance(this.prisma, user.id);

    const [transactions, withdraws] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId: user.id, status: TransactionStatus.COMPLETED },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          createdAt: true,
          description: true,
          status: true,
          amount: true,
          netAmount: true,
          domPaymentId: true,
          domTransactionId: true,
          paymentMethod: true,
        },
      }),
      this.prisma.withdrawRequest.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          amount: true,
          grossAmount: true,
          fee: true,
          createdAt: true,
          updatedAt: true,
          pixKey: true,
        },
      }),
    ]);

    const transacoes = transactions.map((t) => {
      const bruto = Number(t.amount);
      return {
        tipo: 'TRANSACAO' as const,
        id: t.id,
        criadoEm: t.createdAt.toISOString(),
        descricao: t.description,
        status: t.status,
        valorBruto: r2(bruto),
        valorLiquidoRegistrado:
          t.netAmount != null ? r2(Number(t.netAmount)) : null,
        domPaymentId: t.domPaymentId,
        domTransactionId: t.domTransactionId,
        paymentMethod: t.paymentMethod,
      };
    });

    const byAction = await this.prisma.balanceLog.groupBy({
      by: ['action'],
      where: { userId: user.id, NOT: { source: 'MASTER_ADMIN_CONTROL' } },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { action: 'asc' },
    });
    const composicao = {
      modo: 'WALLET_LEDGER',
      saldoNaWallet: r2(balance.balance),
      saldoBloqueado: r2(balance.lockedBalance),
      saldoDisponivel: r2(balance.available),
      saldoNoUltimoLancamentoDoLog: balance.ledgerBalance,
      divergenciaWalletLog: r2(balance.ledgerDrift),
      lancamentosPorAcao: byAction.map((row) => ({
        acao: row.action,
        quantidade: row._count._all,
        soma: r2(Number(row._sum.amount ?? 0)),
      })),
      nota:
        'Saldo disponível = wallet.balance − wallet.lockedBalance, igual para toda conta (plataforma própria, coprodução e afiliado). ' +
        'O BalanceLog é o razão: divergenciaWalletLog diferente de zero indica movimentação sem lançamento.',
    };

    return {
      usuario: {
        id: user.id,
        email: user.email,
        nome: user.name,
        tenantSlug: user.platform?.tag ?? null,
      },
      netBalanceExibido: r2(balance.available),
      composicao,
      transacoes,
      saques: withdraws.map((w) => ({
        tipo: 'SAQUE' as const,
        id: w.id,
        status: w.status,
        valorLiquidoSolicitado: r2(Number(w.amount)),
        valorBrutoDebitadoDaCarteira: r2(Number(w.grossAmount)),
        taxa: r2(Number(w.fee)),
        criadoEm: w.createdAt.toISOString(),
        atualizadoEm: w.updatedAt.toISOString(),
        pixKeyMascarada:
          w.pixKey.length > 6
            ? `${w.pixKey.slice(0, 3)}***${w.pixKey.slice(-3)}`
            : '***',
      })),
    };
  }
}
