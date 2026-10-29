import type { PlatformContext } from './platform-context.service';
import { whereTransactionPlatform } from './transaction-platform';
import { ForbiddenException } from '@nestjs/common';
import { getPlatformOwnerId } from '../module.registry';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { Prisma, TransactionStatus, WithdrawStatus } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/pt-br';
import { getPlatformTaxaEffective } from '../platform-taxas/platform-taxas.store';
import { summarizeRefunds } from '../../application/helpers/refund-report.helper';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('pt-br');

const TZ = 'America/Sao_Paulo';

/**
 * Filtro dos saques que entram na "Taxa de Saque — Simintpay" de uma plataforma.
 * Fonte única: usado tanto no card do dashboard quanto na listagem detalhada.
 * Retorna null quando a plataforma não tem saque centralizado (Areaflix, ou sem userId).
 */
function buildSaqueWhere(params: {
  isAreaflix: boolean;
  isAtlas: boolean;
  isTenantTagged: boolean;
  atlasWalletUserId: string | null;
  platformId: string | null;
  moduleSlug: string;
  saqueStart: Date;
  end: Date;
}): Prisma.WithdrawRequestWhereInput | null {
  const periodo = {
    status: { in: [WithdrawStatus.APPROVED, WithdrawStatus.COMPLETED] },
    updatedAt: { gte: params.saqueStart, lte: params.end },
  };

  if (params.isAreaflix) return null;
  if (params.isAtlas) {
    // Atlas: conta técnica própria, sem filtro de fee (lançamentos podem vir zerados).
    return params.atlasWalletUserId
      ? { userId: params.atlasWalletUserId, ...periodo }
      : null;
  }
  if (params.isTenantTagged) {
    return {
      user: { platform: { tag: params.moduleSlug } },
      fee: { gt: 0 },
      ...periodo,
    };
  }
  return params.platformId
    ? { userId: params.platformId, fee: { gt: 0 }, ...periodo }
    : null;
}

@Injectable()
export class PlatformOverviewReports {
  private readonly logger = new Logger(PlatformOverviewReports.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context?: PlatformContext,
  ) {}

  private owner(tag: string) {
    return this.context?.tag === tag
      ? this.context.ownerUserId
      : getPlatformOwnerId(tag);
  }

  private async current(tag: string) {
    if (!this.context) return;
    const row = await this.prisma.platform.findUnique({
      where: { id: this.context.id },
      include: { owner: true },
    });
    if (
      !row?.isActive ||
      !row.owner.isActive ||
      row.owner.isPurged ||
      row.ownerUserId !== this.context.ownerUserId ||
      row.tag !== this.context.tag ||
      tag.toUpperCase() !== row.tag
    )
      throw new ForbiddenException('Contexto da plataforma mudou');
  }

  private async scope(
    where: Prisma.TransactionWhereInput,
  ): Promise<Prisma.TransactionWhereInput> {
    if (!this.context) return where;
    return { AND: [where, whereTransactionPlatform(this.context.tag)] };
  }

  private withdrawalScope(
    where: Prisma.WithdrawRequestWhereInput,
  ): Prisma.WithdrawRequestWhereInput {
    return this.context
      ? { AND: [where, { platform: this.context.tag.toLowerCase() }] }
      : where;
  }

  /**
   * Saques aprovados da plataforma no período, um a um, com a taxa que foi cobrada
   * em cada um (campo `fee`, gravado no momento do saque — não recalculado com a
   * taxa atual). A soma de `fee` bate com o card "Taxa de Saque — Simintpay".
   */
  async getSaquesDetalhados(
    tag: string,
    dataInicio?: string,
    dataFim?: string,
  ) {
    await this.current(tag);
    const upperTag = (tag || 'renovada').toUpperCase();
    const now = dayjs().tz(TZ);

    const isAtlas = upperTag === 'ATLAS';
    const isAreaflix = upperTag === 'AREAFLIX';
    const isKnownFixedTag = [
      'RENOVADA',
      'PAGATG',
      'BOSQUE',
      'REVALIDA',
      'EBOOK',
      'EBOOKSIM',
      'AREAFLIX',
      'ATLAS',
      'CONTROLE-MOTORISTA',
      'CONTROLE-PATRIMONIAL',
      'FRENDZ',
      'BETAI',
      'GLOBAL',
    ].includes(upperTag);
    const isTenantTagged =
      upperTag === 'EBOOK' ||
      upperTag === 'EBOOKSIM' ||
      upperTag === 'PAGATG' ||
      !isKnownFixedTag;

    const atlasWalletUserId = isAtlas ? this.owner('ATLAS') : null;

    const platformId =
      isTenantTagged || isAreaflix ? null : this.owner(upperTag);

    // Mesma janela do card: sem período explícito, conta a partir do dia 1 do mês atual.
    const saqueStart = dataInicio
      ? dayjs(dataInicio).startOf('day').toDate()
      : now.startOf('month').toDate();
    const end = dataFim ? dayjs(dataFim).endOf('day').toDate() : now.toDate();

    const where = buildSaqueWhere({
      isAreaflix,
      isAtlas,
      isTenantTagged,
      atlasWalletUserId,
      platformId,
      moduleSlug: upperTag.toLowerCase(),
      saqueStart,
      end,
    });

    if (!where) {
      return {
        data: [],
        quantidade: 0,
        totalFee: 0,
        periodo: { inicio: saqueStart, fim: end },
      };
    }

    const saques = await this.prisma.withdrawRequest.findMany({
      where: this.withdrawalScope(where),
      select: {
        id: true,
        grossAmount: true,
        amount: true,
        fee: true,
        status: true,
        pixKey: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const data = saques.map((s) => ({
      id: s.id,
      solicitadoEm: s.createdAt,
      aprovadoEm: s.updatedAt,
      usuario: s.user?.name ?? s.user?.email ?? '—',
      email: s.user?.email ?? '',
      chavePix: s.pixKey,
      valorBruto: Number(s.grossAmount ?? 0),
      valorLiquido: Number(s.amount ?? 0),
      // Taxa gravada no saque — é a que estava vigente naquele momento, não a atual.
      taxaCobrada: Number(s.fee ?? 0),
      status: s.status,
    }));

    return {
      data,
      quantidade: data.length,
      totalFee: Number(
        data.reduce((acc, d) => acc + d.taxaCobrada, 0).toFixed(2),
      ),
      periodo: { inicio: saqueStart, fim: end },
    };
  }

  async getDashboardData(
    tag: string,
    period: string = 'hoje',
    dataInicio?: string,
    dataFim?: string,
  ) {
    await this.current(tag);
    const upperTag = (tag || 'renovada').toUpperCase();
    const now = dayjs().tz(TZ);
    let start: Date;
    let end: Date = now.toDate();

    // Plataformas multi-vendor usam a tag na descrição, não um userId técnico.
    const isEbook = upperTag === 'EBOOK' || upperTag === 'EBOOKSIM';
    const isPagatg = upperTag === 'PAGATG';
    // Controle Motorista e Controle Patrimonial não têm carteira centralizada.
    // As transações da tela pertencem ao escopo [TENANT:CONTROLE-*].
    const isControle =
      upperTag === 'CONTROLE-MOTORISTA' || upperTag === 'CONTROLE-PATRIMONIAL';
    const isAtlas = upperTag === 'ATLAS';
    const isBosque = upperTag === 'BOSQUE';
    // AREAFLIX usa sistema de ordens próprio (não Transaction table com userId centralizado)
    const isAreaflix = upperTag === 'AREAFLIX';
    // Unknown tags (community slugs) → use [TENANT:SLUG] filter; returns 0 from Transaction table
    // since community revenue is tracked via SubscriptionLinkOrder, not Transaction.
    const isKnownFixedTag = [
      'RENOVADA',
      'PAGATG',
      'BOSQUE',
      'REVALIDA',
      'EBOOK',
      'EBOOKSIM',
      'AREAFLIX',
      'ATLAS',
      'CONTROLE-MOTORISTA',
      'CONTROLE-PATRIMONIAL',
      'FRENDZ',
      'BETAI',
      'GLOBAL',
    ].includes(upperTag);
    const isTenantTagged =
      isEbook || isPagatg || isControle || !isKnownFixedTag;

    const bosqueTxWhere = {
      status: TransactionStatus.COMPLETED,
      ...whereTransactionPlatform('BOSQUE'),
    };

    // Carteira/saques Atlas: conta técnica (não usar fallback Renovada no userId)
    const atlasWalletUserId = isAtlas ? this.owner('ATLAS') : null;

    // Dono explicitamente atribuído no cadastro da plataforma.
    const platformId =
      isTenantTagged || isAreaflix ? null : this.owner(upperTag);

    if (dataInicio || dataFim) {
      start = dataInicio
        ? dayjs(dataInicio).startOf('day').toDate()
        : now.subtract(10, 'year').toDate();
      end = dataFim ? dayjs(dataFim).endOf('day').toDate() : now.toDate();
    } else {
      switch (period) {
        case 'ontem':
          start = now.subtract(1, 'day').startOf('day').toDate();
          end = now.subtract(1, 'day').endOf('day').toDate();
          break;
        case '7dias':
          start = now.subtract(7, 'day').startOf('day').toDate();
          break;
        case '15dias':
          start = now.subtract(15, 'day').startOf('day').toDate();
          break;
        case '30dias':
          start = now.subtract(30, 'day').startOf('day').toDate();
          break;
        case 'hoje':
        default:
          start = now.startOf('day').toDate();
          break;
      }
    }

    const todayStart = now.startOf('day').toDate();
    const sevenDaysAgo = now.subtract(7, 'day').startOf('day').toDate();
    const fifteenDaysAgo = now.subtract(15, 'day').startOf('day').toDate();
    const thirtyDaysAgo = now.subtract(30, 'day').startOf('day').toDate();
    const yearStart = now.startOf('year').toDate();

    this.logger.log(
      `[Dashboard] Tag: ${upperTag} | Período "${period}": ${dayjs(start).tz(TZ).format('DD/MM/YYYY HH:mm:ss')}`,
    );

    // Atlas: descrição "atlas". Bosque: [TENANT:BOSQUE] ou "bosque" na descrição. AREAFLIX: usa sistema de ordens próprio.
    const filter: any = isAtlas
      ? {
          status: TransactionStatus.COMPLETED,
          ...whereTransactionPlatform('ATLAS'),
        }
      : isBosque
        ? bosqueTxWhere
        : isAreaflix
          ? {
              status: TransactionStatus.COMPLETED,
              ...whereTransactionPlatform('AREAFLIX'),
            }
          : isTenantTagged
            ? {
                status: TransactionStatus.COMPLETED,
                ...whereTransactionPlatform(upperTag),
              }
            : upperTag === 'RENOVADA'
              ? // RENOVADA mantém userId puro — o bloco abaixo adiciona filter.OR com keywords
                // (dizimo/oferta/...) e um OR de escopo aqui seria sobrescrito por ele.
                { userId: platformId, status: TransactionStatus.COMPLETED }
              : // Demais fixas (REVALIDA, BETAI, CONTROLE-*…): userId OU [TENANT:tag] — só userId
                // deixava de fora vendas marcadas com a tag feitas por outras contas (mesmo bug
                // dos cards do Atlas/EbookSim: listagem mostrava e cards ficavam zerados).
                {
                  status: TransactionStatus.COMPLETED,
                  OR: [
                    ...(platformId ? [{ userId: platformId }] : []),
                    {
                      ...whereTransactionPlatform(upperTag),
                    },
                  ],
                };

    const allTransactions = await this.prisma.transaction.findMany({
      where: await this.scope(filter),
      select: {
        amount: true,
        netAmount: true,
        description: true,
        createdAt: true,
      },
    });

    // Resolve liquidity and fees via store (env vars + DB overrides), same as consolidado
    const liquidityFactor = getPlatformTaxaEffective(
      upperTag,
      'LIQUIDEZ',
      0.91,
    );
    const fixedFee = getPlatformTaxaEffective(
      upperTag,
      'TAXA_FIXA_TRANSACAO',
      1.0,
    );
    const cashbackFee = getPlatformTaxaEffective(
      upperTag,
      'TAXA_CASHBACK',
      3.0,
    );
    const adminMargin = 1 - liquidityFactor;

    const getProfit = (txs: any[]) => {
      let total = 0;
      let maquinetas = 0;
      let offers = 0;
      let lucroSimpay = 0;

      txs.forEach((tx) => {
        const net = Number(tx.netAmount || 0);
        const bruto = Number(tx.amount || net / liquidityFactor);

        total += net;
        lucroSimpay += Number(
          (bruto * adminMargin - fixedFee - cashbackFee).toFixed(2),
        );

        const desc = (tx.description || '').toLowerCase();
        if (desc.includes('maquineta') || desc.includes('terminal')) {
          maquinetas += net;
        } else {
          offers += net;
        }
      });
      const getPct = (val: number) => (total > 0 ? (val / total) * 100 : 0);
      return {
        total: Number(total.toFixed(2)),
        maquinetas: Number(maquinetas.toFixed(2)),
        offers: Number(offers.toFixed(2)),
        lucroSimpay: Number(lucroSimpay.toFixed(2)),
        maquinetasPct: getPct(maquinetas),
        offersPct: getPct(offers),
      };
    };

    const txsInPeriod = allTransactions.filter((tx) => {
      const d = dayjs(tx.createdAt);
      return (
        (d.isAfter(start) || d.isSame(start)) &&
        (d.isBefore(end) || d.isSame(end))
      );
    });

    const profitSelected = getProfit(txsInPeriod);
    const profitTotal = getProfit(allTransactions);

    // 2. Dados da Wallet — EBOOK/PAGATG multi-vendor; Atlas usa conta técnica; AREAFLIX usa sistema próprio; Renovada usa lógica especial
    const wallet =
      isTenantTagged || isAreaflix
        ? null
        : isAtlas
          ? atlasWalletUserId
            ? await this.prisma.wallet.findUnique({
                where: { userId: atlasWalletUserId },
              })
            : null
          : await this.prisma.wallet.findUnique({
              where: { userId: platformId! },
            });
    const balanceVal = Number(wallet?.balance || 0);
    const lockedVal = Number(wallet?.lockedBalance || 0);

    let availableBalanceNet: number;
    if (isTenantTagged || isAreaflix) {
      availableBalanceNet = 0; // multi-vendor / AREAFLIX: sem carteira centralizada
    } else if (isAtlas) {
      availableBalanceNet = atlasWalletUserId
        ? Number(((balanceVal - lockedVal) * liquidityFactor).toFixed(3))
        : 0;
    } else if (upperTag === 'RENOVADA') {
      // wallet.balance stores net (DOM liquid_amount). Approved withdrawals are already deducted
      // from wallet.balance at approval time. lockedBalance tracks pending withdrawal gross.
      availableBalanceNet = Number(
        Math.max(0, balanceVal - lockedVal).toFixed(2),
      );
    } else {
      availableBalanceNet = Number(
        ((balanceVal - lockedVal) * liquidityFactor).toFixed(3),
      );
    }

    // 3. Estornos
    // O relatório por produto usa o período da venda, igual à tabela de
    // transações exibida logo abaixo dos cards. A transição para REFUNDED pode
    // ocorrer meses depois e não deve retirar a venda do período selecionado.
    const estornosWhere: Prisma.TransactionWhereInput = isAtlas
      ? {
          status: TransactionStatus.REFUNDED,
          ...whereTransactionPlatform('ATLAS'),
        }
      : isBosque
        ? {
            status: TransactionStatus.REFUNDED,
            ...whereTransactionPlatform('BOSQUE'),
          }
        : isAreaflix
          ? {
              status: TransactionStatus.REFUNDED,
              ...whereTransactionPlatform('AREAFLIX'),
            }
          : isTenantTagged
            ? {
                status: TransactionStatus.REFUNDED,
                ...whereTransactionPlatform(upperTag),
              }
            : platformId
              ? {
                  userId: platformId,
                  status: TransactionStatus.REFUNDED,
                  ...(filter.OR ? { OR: filter.OR } : {}),
                }
              : { id: '__missing-platform-id__' };
    const chargebacksWhere: any = isAtlas
      ? {
          status: TransactionStatus.CHARGEBACK,
          createdAt: { gte: start, lte: end },
          ...whereTransactionPlatform('ATLAS'),
        }
      : isBosque
        ? {
            status: TransactionStatus.CHARGEBACK,
            createdAt: { gte: start, lte: end },
            ...whereTransactionPlatform('BOSQUE'),
          }
        : isAreaflix
          ? {
              status: TransactionStatus.CHARGEBACK,
              createdAt: { gte: start, lte: end },
              ...whereTransactionPlatform('AREAFLIX'),
            }
          : isTenantTagged
            ? {
                status: TransactionStatus.CHARGEBACK,
                createdAt: { gte: start, lte: end },
                ...whereTransactionPlatform(upperTag),
              }
            : platformId
              ? {
                  userId: platformId,
                  status: TransactionStatus.CHARGEBACK,
                  createdAt: { gte: start, lte: end },
                  ...(filter.OR ? { OR: filter.OR } : {}),
                }
              : { id: '__missing-platform-id__' };

    const [estornoTransactions, chargebacksAgg] = await Promise.all([
      this.prisma.transaction.findMany({
        where: await this.scope(estornosWhere),
        select: {
          netAmount: true,
          createdAt: true,
          updatedAt: true,
          statusHistory: {
            where: { toStatus: TransactionStatus.REFUNDED },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
      this.prisma.transaction.aggregate({
        where: await this.scope(chargebacksWhere),
        _count: { id: true },
        _sum: { netAmount: true },
      }),
    ]);
    const estornos = summarizeRefunds(
      estornoTransactions.map((transaction) => ({
        amount: transaction.netAmount,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        statusHistory: transaction.statusHistory,
      })),
      { start, end, dateBasis: 'transaction' },
    );

    // 4. Saques — EBOOK/PAGATG/AREAFLIX não têm saques centralizados
    const withdrawals =
      isTenantTagged || isAreaflix
        ? []
        : isAtlas
          ? atlasWalletUserId
            ? await this.prisma.withdrawRequest.findMany({
                where: this.withdrawalScope({ userId: atlasWalletUserId }),
                select: { createdAt: true },
              })
            : []
          : await this.prisma.withdrawRequest.findMany({
              where: this.withdrawalScope({ userId: platformId! }),
              select: { createdAt: true },
            });

    const countWD = (s: Date, e: Date = now.toDate()) => {
      const startD = dayjs(s);
      const endD = dayjs(e);
      return withdrawals.filter((w) => {
        const wDate = dayjs(w.createdAt);
        return (
          (wDate.isAfter(startD) || wDate.isSame(startD)) &&
          (wDate.isBefore(endD) || wDate.isSame(endD))
        );
      }).length;
    };
    // Quando nenhum período explícito é passado, os saques contam desde o dia 1 do mês atual
    const saqueStart = dataInicio ? start : now.startOf('month').toDate();
    const moduleSlug = upperTag.toLowerCase();

    // Filtro compartilhado com getSaquesDetalhados: o modal precisa listar exatamente
    // os mesmos saques que somam o valor deste card.
    const saqueWhere = buildSaqueWhere({
      isAreaflix,
      isAtlas,
      isTenantTagged,
      atlasWalletUserId,
      platformId,
      moduleSlug,
      saqueStart,
      end,
    });
    const saquesNoPeriodo = saqueWhere
      ? await this.prisma.withdrawRequest.findMany({
          where: this.withdrawalScope(saqueWhere),
          select: { id: true, fee: true },
        })
      : [];

    const qtdSaquesNoPeriodo = saquesNoPeriodo.length;

    // lucroSimpay = soma do campo fee de cada saque aprovado (R$2 por padrão).
    // O DOM usa lançamentos manuais (FEE_INC logs) registrados separadamente.
    const lucroSimpay = Number(
      saquesNoPeriodo
        .reduce((acc, s) => acc + Number(s.fee ?? 0), 0)
        .toFixed(2),
    );

    // Taxa de Saque — DOM: soma dos registros manuais de taxa DOM (FEE_INC logs)
    const domLogs = await this.prisma.balanceLog.aggregate({
      where: {
        action: 'ADMIN_WITHDRAW_FEE_INC',
        source: 'MASTER_ADMIN_CONTROL',
        createdAt: { gte: saqueStart, lte: end },
        metadata: { path: ['platformTag'], equals: upperTag },
      },
      _sum: { balanceDelta: true },
    });

    const taxaTotalDOM = Math.max(
      0,
      Number(Number(domLogs._sum.balanceDelta ?? 0).toFixed(2)),
    );

    const saqueFees = {
      quantidade: qtdSaquesNoPeriodo,
      taxaTotalDOM,
      lucroSimpay,
      taxaTotal: Number((lucroSimpay + taxaTotalDOM).toFixed(2)),
    };

    const chartPlatformId =
      isTenantTagged || isAtlas || isBosque || isAreaflix ? null : platformId;
    const chartTenant = isTenantTagged ? upperTag : null;
    const chartDescContains = isAtlas
      ? 'atlas'
      : isAreaflix
        ? 'areaflix'
        : null;
    const last30Days = await this.getChartData(
      chartPlatformId,
      30,
      'day',
      liquidityFactor,
      chartTenant,
      chartDescContains,
      isBosque,
    );
    const annualByMonth = await this.getChartData(
      chartPlatformId,
      12,
      'month',
      liquidityFactor,
      chartTenant,
      chartDescContains,
      isBosque,
    );

    const selectedRange = await this.getChartSeriesForSelectedRange(
      start,
      end,
      chartPlatformId,
      chartTenant,
      chartDescContains,
      isBosque,
    );

    const isFiltered = !!(dataInicio || dataFim);
    const mainProfit = isFiltered ? profitSelected : profitTotal;

    return {
      period,
      isFiltered,
      summary: {
        availableBalance: availableBalanceNet,
        balanceInProcessing: 0,
      },
      selected: {
        profit: profitSelected,
        withdrawals: countWD(start, end),
      },
      profit: {
        total: Number(mainProfit.total.toFixed(2)),
        maquinetas: Number(mainProfit.maquinetas.toFixed(2)),
        offers: Number(mainProfit.offers.toFixed(2)),
        lucroSimpay: Number(mainProfit.lucroSimpay.toFixed(2)),
        today: getProfit(
          allTransactions.filter(
            (tx) =>
              dayjs(tx.createdAt).isAfter(dayjs(todayStart)) ||
              dayjs(tx.createdAt).isSame(dayjs(todayStart)),
          ),
        ),
        sevenDays: getProfit(
          allTransactions.filter(
            (tx) =>
              dayjs(tx.createdAt).isAfter(dayjs(sevenDaysAgo)) ||
              dayjs(tx.createdAt).isSame(dayjs(sevenDaysAgo)),
          ),
        ),
        fifteenDays: getProfit(
          allTransactions.filter(
            (tx) =>
              dayjs(tx.createdAt).isAfter(dayjs(fifteenDaysAgo)) ||
              dayjs(tx.createdAt).isSame(dayjs(fifteenDaysAgo)),
          ),
        ),
        thirtyDays: getProfit(
          allTransactions.filter(
            (tx) =>
              dayjs(tx.createdAt).isAfter(dayjs(thirtyDaysAgo)) ||
              dayjs(tx.createdAt).isSame(dayjs(thirtyDaysAgo)),
          ),
        ),
        annual: getProfit(
          allTransactions.filter(
            (tx) =>
              dayjs(tx.createdAt).isAfter(dayjs(yearStart)) ||
              dayjs(tx.createdAt).isSame(dayjs(yearStart)),
          ),
        ),
        charts: {
          last30Days,
          annualByMonth,
          selectedRange,
        },
      },
      estornos: {
        quantidade: estornos.quantidade,
        valorLiquido: estornos.valor,
      },
      chargebacks: {
        quantidade: chargebacksAgg._count.id,
        valorLiquido: Number(
          Number(chargebacksAgg._sum.netAmount || 0).toFixed(2),
        ),
      },
      saqueFees,
      withdrawals: {
        today: countWD(todayStart),
        sevenDays: countWD(sevenDaysAgo),
        fifteenDays: countWD(fifteenDaysAgo),
        thirtyDays: countWD(thirtyDaysAgo),
        annual: countWD(yearStart),
        selected: countWD(start, end),
      },
    };
  }

  /**
   * Gráfico do período filtrado (painel): um ponto por dia, ou 24 pontos por hora se dataInicio/dataFim forem o mesmo dia.
   */
  private async getChartSeriesForSelectedRange(
    rangeStart: Date,
    rangeEnd: Date,
    platformId: string | null,
    tenantTag: string | null,
    descriptionContains: string | null,
    useBosqueDescriptionOr: boolean,
  ): Promise<
    { label: string; value: number; maquinetas: number; offers: number }[]
  > {
    const baseWhere: any = useBosqueDescriptionOr
      ? {
          status: TransactionStatus.COMPLETED,
          ...whereTransactionPlatform('BOSQUE'),
        }
      : descriptionContains
        ? {
            status: TransactionStatus.COMPLETED,
            description: {
              contains: descriptionContains,
              mode: 'insensitive' as const,
            },
          }
        : tenantTag
          ? {
              status: TransactionStatus.COMPLETED,
              ...whereTransactionPlatform(tenantTag),
            }
          : {
              userId: platformId,
              status: TransactionStatus.COMPLETED,
            };

    const txs = await this.prisma.transaction.findMany({
      where: await this.scope({
        ...baseWhere,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      }),
      select: { netAmount: true, description: true, createdAt: true },
    });

    const zStart = dayjs(rangeStart).tz(TZ).startOf('day');
    const zEndDay = dayjs(rangeEnd).tz(TZ).startOf('day');
    const sameCalendarDay = zStart.isSame(zEndDay, 'day');

    const pushPoint = (label: string, maquinetas: number, offers: number) => ({
      label,
      value: Number((maquinetas + offers).toFixed(2)),
      maquinetas: Number(maquinetas.toFixed(2)),
      offers: Number(offers.toFixed(2)),
    });

    if (sameCalendarDay) {
      const buckets = Array.from({ length: 24 }, () => ({
        maquinetas: 0,
        offers: 0,
      }));
      for (const tx of txs) {
        const h = dayjs(tx.createdAt).tz(TZ).hour();
        const net = Number(tx.netAmount || 0);
        const desc = (tx.description || '').toLowerCase();
        const slot = buckets[h]!;
        if (desc.includes('maquineta') || desc.includes('terminal')) {
          slot.maquinetas += net;
        } else {
          slot.offers += net;
        }
      }
      return buckets.map((b, h) =>
        pushPoint(`${String(h).padStart(2, '0')}h`, b.maquinetas, b.offers),
      );
    }

    const dayKeys: string[] = [];
    let cursor = zStart;
    const last = zEndDay;
    while (!cursor.isAfter(last, 'day')) {
      dayKeys.push(cursor.format('YYYY-MM-DD'));
      cursor = cursor.add(1, 'day');
    }

    const byDay = new Map<string, { maquinetas: number; offers: number }>();
    for (const k of dayKeys) {
      byDay.set(k, { maquinetas: 0, offers: 0 });
    }

    for (const tx of txs) {
      const k = dayjs(tx.createdAt).tz(TZ).format('YYYY-MM-DD');
      const slot = byDay.get(k);
      if (!slot) continue;
      const net = Number(tx.netAmount || 0);
      const desc = (tx.description || '').toLowerCase();
      if (desc.includes('maquineta') || desc.includes('terminal')) {
        slot.maquinetas += net;
      } else {
        slot.offers += net;
      }
    }

    return dayKeys.map((k) => {
      const b = byDay.get(k)!;
      const [, m, d] = k.split('-');
      return pushPoint(`${d}/${m}`, b.maquinetas, b.offers);
    });
  }

  private async getChartData(
    platformId: string | null,
    count: number,
    unit: 'day' | 'month',
    liquidityFactor: number,
    tenantTag: string | null = null,
    descriptionContains: string | null = null,
    useBosqueDescriptionOr = false,
  ) {
    const data: {
      label: string;
      value: number;
      maquinetas: number;
      offers: number;
    }[] = [];
    const now = dayjs().tz(TZ);

    for (let i = count - 1; i >= 0; i--) {
      const d = now.subtract(i, unit);
      const start = d.startOf(unit).toDate();
      const end = d.endOf(unit).toDate();
      const chartWhere: any = useBosqueDescriptionOr
        ? {
            status: TransactionStatus.COMPLETED,
            createdAt: { gte: start, lte: end },
            ...whereTransactionPlatform('BOSQUE'),
          }
        : descriptionContains
          ? {
              status: TransactionStatus.COMPLETED,
              createdAt: { gte: start, lte: end },
              description: {
                contains: descriptionContains,
                mode: 'insensitive' as const,
              },
            }
          : tenantTag
            ? {
                status: TransactionStatus.COMPLETED,
                createdAt: { gte: start, lte: end },
                ...whereTransactionPlatform(tenantTag),
              }
            : {
                userId: platformId,
                status: TransactionStatus.COMPLETED,
                createdAt: { gte: start, lte: end },
              };
      const txs = await this.prisma.transaction.findMany({
        where: await this.scope(chartWhere),
        select: { netAmount: true, description: true },
      });

      let maquinetas = 0;
      let offers = 0;
      for (const tx of txs) {
        const net = Number(tx.netAmount || 0);
        if (
          tx.description?.toLowerCase().includes('maquineta') ||
          tx.description?.toLowerCase().includes('terminal')
        ) {
          maquinetas += net;
        } else {
          offers += net;
        }
      }

      const label = unit === 'day' ? d.format('DD/MM') : d.format('MMM');
      const value = Number((maquinetas + offers).toFixed(2));

      data.push({
        label,
        value,
        maquinetas: Number(maquinetas.toFixed(2)),
        offers: Number(offers.toFixed(2)),
      });
    }

    return data;
  }
}
