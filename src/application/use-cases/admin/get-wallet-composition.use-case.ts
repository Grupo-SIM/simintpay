import { getPlatformOwnerId } from '../../../modules/module.registry';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransactionStatus, WithdrawStatus } from '@prisma/client';
import { computeUserNetBalance } from '../../helpers/user-platform-net-balance.helper';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleConfig } from '../../../modules/module.registry';

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
          include: { tenantModule: true },
        })
      : await this.prisma.user.findUnique({
          where: { email: email!.toLowerCase() },
          include: { tenantModule: true },
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

    const netBalance = await computeUserNetBalance(
      this.prisma,
      user.id,
      user.tenantModule?.slug,
    );

    const fatorLiquidez =
      getModuleConfig(user.tenantModule?.slug)?.saque?.fatorLiquidez ??
      getPlatformTaxaEffective('GLOBAL', 'LIQUIDEZ', 0.91);

    const renovadaId =
      (getPlatformOwnerId('RENOVADA') ?? '');
    const slug = (user.tenantModule?.slug || '').toLowerCase();
    const useRenovadaWalletLedger =
      slug === 'renovada';

    const fatorRenovada =
      getModuleConfig('renovada')?.saque?.fatorLiquidez ??
      getPlatformTaxaEffective('RENOVADA', 'LIQUIDEZ', 0.91);

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

    const somaTransacoesLiquidasPadrao = transactions.reduce((s, t) => {
      const bruto = Number(t.amount);
      if (bruto <= 0) return s;
      const liquido =
        t.netAmount != null ? Number(t.netAmount) : bruto * fatorLiquidez;
      return s + liquido;
    }, 0);

    const transacoes = transactions.map((t) => {
      const bruto = Number(t.amount);
      const liquido =
        t.netAmount != null ? Number(t.netAmount) : bruto * fatorLiquidez;
      return {
        tipo: 'TRANSACAO' as const,
        id: t.id,
        criadoEm: t.createdAt.toISOString(),
        descricao: t.description,
        status: t.status,
        valorBruto: r2(bruto),
        valorLiquidoRegistrado:
          t.netAmount != null ? r2(Number(t.netAmount)) : null,
        contribuicaoLiquidaNoModoPadrao: bruto > 0 ? r2(liquido) : 0,
        domPaymentId: t.domPaymentId,
        domTransactionId: t.domTransactionId,
        paymentMethod: t.paymentMethod,
      };
    });

    let composicao: Record<string, unknown>;

    if (useRenovadaWalletLedger) {
      const storedGross = Number(wallet.balance);
      const [debitedAggr, pendingAggr] = await Promise.all([
        this.prisma.withdrawRequest.aggregate({
          where: {
            userId: user.id,
            status: {
              in: [WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED],
            },
          },
          _sum: { grossAmount: true },
        }),
        this.prisma.withdrawRequest.aggregate({
          where: { userId: user.id, status: WithdrawStatus.PENDING },
          _sum: { grossAmount: true },
        }),
      ]);
      const debitedBruto = Number(debitedAggr._sum.grossAmount || 0);
      const pendingBruto = Number(pendingAggr._sum.grossAmount || 0);
      const rawDisplayTotalNet =
        storedGross * fatorRenovada + debitedBruto * (fatorRenovada - 1);
      const displayTotalNet = Math.max(0, rawDisplayTotalNet);
      const availableNet = Math.max(0, displayTotalNet - pendingBruto);

      composicao = {
        modo: 'RENOVADA_LEDGER',
        fatorLiquidezRenovada: fatorRenovada,
        saldoBrutoArmazenadoNaWallet: r2(storedGross),
        somaSaquesAprovadosOuPagos_brutoRetirado: r2(debitedBruto),
        termoCorrecaoSaques: r2(debitedBruto * (fatorRenovada - 1)),
        liquidoAntesReservaPendente: r2(displayTotalNet),
        somaSaquesPendentes_brutoBloqueado: r2(pendingBruto),
        saldoLiquidoDisponivelExibido: r2(availableNet),
        confereComNetBalance: r2(availableNet) === r2(netBalance),
        somaReferenciaTransacoesLiquidas: r2(somaTransacoesLiquidasPadrao),
        nota:
          'Conta Renovada: o saldo exibido vem de wallet.balance (bruto) × fator + correção (fator−1)×saques aprovados/pagos, menos bruto pendente. ' +
          'A lista de transações é a movimentação COMPLETED no userId; a soma líquida delas pode diferir do saldo por causa desse ledger.',
      };
    } else {
      const [completedAggr, activeAggr] = await Promise.all([
        this.prisma.withdrawRequest.aggregate({
          where: { userId: user.id, status: WithdrawStatus.COMPLETED },
          _sum: { grossAmount: true },
        }),
        this.prisma.withdrawRequest.aggregate({
          where: {
            userId: user.id,
            status: {
              in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED],
            },
          },
          _sum: { grossAmount: true },
        }),
      ]);
      const totalCompletedGross = Number(completedAggr._sum.grossAmount || 0);
      const lockedBalanceGross = Number(activeAggr._sum.grossAmount || 0);
      const currentNetProfit = somaTransacoesLiquidasPadrao - totalCompletedGross;
      const availableBalance = Math.max(
        0,
        currentNetProfit - lockedBalanceGross,
      );

      composicao = {
        modo: 'PADRAO_TRANSACOES_MENOS_SAQUES',
        fatorLiquidez,
        somaTransacoesConcluidas_valorLiquido: r2(somaTransacoesLiquidasPadrao),
        menosSaqueConcluido_valorBruto: r2(totalCompletedGross),
        saldoAposSaquesConcluidos: r2(currentNetProfit),
        menosSaquesPendentesOuAprovados_valorBruto: r2(lockedBalanceGross),
        saldoLiquidoDisponivelCalculado: r2(availableBalance),
        confereComNetBalance: r2(availableBalance) === r2(netBalance),
        nota:
          'Soma do líquido (netAmount ou bruto × fator) das transações COMPLETED com bruto > 0, menos bruto de saques COMPLETED, menos bruto retido em PENDING/APPROVED.',
      };
    }

    return {
      usuario: {
        id: user.id,
        email: user.email,
        nome: user.name,
        tenantSlug: user.tenantModule?.slug ?? null,
      },
      netBalanceExibido: r2(netBalance),
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
