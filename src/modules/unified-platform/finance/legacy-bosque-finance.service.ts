import { PlatformMaintenanceService } from './platform-maintenance.service';
import { PlatformFinanceService } from './platform-finance.service';
import { Injectable } from '@nestjs/common';
import { getPlatformIntegrationValue } from '../../../modules/platform-integrations/platform-integrations.store';
import { getPlatformOwnerId } from '../../../modules/module.registry';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { BosqueConfig } from '../../../modules/bosque/bosque.config';
import { computeBosqueAvailableSinceLastWithdrawal } from '../../../application/helpers/bosque-available.helper';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

/** BOSQUE passou a cobrar TAXA_SERVICO (R$4 Sim Int Pay) a partir de 2026-05-29 — mesma data da Renovada. */
const BOSQUE_TAXA_SERVICO_DATE = new Date('2026-05-29T20:40:00.000Z');

/**
 * pixKey usado no registro de "baseline" (POST /zerar-disponivel) — um saque sintético
 * que representa vendas antigas já liquidadas por fora, zerando o disponível a partir de
 * agora. É contado pelo cálculo do disponível (para zerar), mas escondido do histórico.
 */
const BASELINE_PIXKEY = 'BASELINE_SALDO';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Injectable()
export class InternalBosqueFinanceService {
  constructor(private readonly prisma: PrismaService, private readonly finance: PlatformFinanceService) {}

  private ensureInternalToken(token?: string) {
    const expected = getPlatformIntegrationValue('BOSQUE', 'INTERNAL_TOKEN');
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  private normalizeCpf(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private cpfVariants(raw: string): string[] {
    const cpf = this.normalizeCpf(raw);
    if (!cpf || cpf.length !== 11) return [];
    return [cpf, cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
  }

  private async resolveUserIdsByCpf(cpf: string, directUserId?: string): Promise<string[]> {
    const ids = new Set<string>();

    const variants = this.cpfVariants(cpf);
    if (variants.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { cpf: { in: variants } },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (directUserId?.trim()) {
      ids.add(directUserId.trim());
    }

    return [...ids];
  }

  /**
   * Resolve a conta única do Bosque (IBB). O módulo é só de gestão (sem CPF de
   * vendedor), então a ordem é: userId → email → cpf → fallback BOSQUE_ID do ambiente.
   */
  private async resolveBosqueUserId(opts: { userId?: string; email?: string; cpf?: string }): Promise<string | null> {
    if (opts.userId?.trim()) return opts.userId.trim();

    if (opts.email?.trim()) {
      const u = await this.prisma.user.findFirst({
        where: { email: opts.email.trim() },
        select: { id: true },
      });
      if (u) return u.id;
    }

    const variants = this.cpfVariants(opts.cpf ?? '');
    if (variants.length > 0) {
      const u = await this.prisma.user.findFirst({
        where: { cpf: { in: variants } },
        select: { id: true },
      });
      if (u) return u.id;
    }

    const envId = (getPlatformOwnerId('BOSQUE') ?? '');
    return envId || null;
  }

  private buildOwnerFilter(cpf: string, userIds: string[]): any {
    const cpfClean = this.normalizeCpf(cpf);
    const conditions: any[] = [];

    if (userIds.length > 0) {
      conditions.push({ userId: { in: userIds } });
    }

    if (cpfClean.length === 11) {
      conditions.push({ description: { contains: `[CPF_DONO:${cpfClean}]`, mode: 'insensitive' } });
    }

    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0];
    return { OR: conditions };
  }

  /**
   * Saldo disponível canônico do Bosque — delega ao helper compartilhado, reutilizado
   * também pelo relatório master (/admin/plataformas/saldos-resumo) para bater com este painel.
   */
  private computeAvailableSinceLastWithdrawal(userIds: string[]): Promise<number> {
    return computeBosqueAvailableSinceLastWithdrawal(this.prisma, userIds);
  }
  async summary( cpf: string, userId?: string, internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);

    if (userIds.length === 0) {
      return { availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0, netLockedBalance: 0 };
    }

    // Saldo disponível = líquido recebido desde o último saque (fonte canônica).
    const availableBalance = await this.computeAvailableSinceLastWithdrawal(userIds);

    // Saque pendente (info para os cards "Saque em processo" / "Em processamento").
    const wdPending = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: 'PENDING' },
      _sum: { grossAmount: true, amount: true },
    });
    const pendingGross = Number(wdPending._sum.grossAmount ?? wdPending._sum.amount ?? 0);
    const pendingNet = Number(wdPending._sum.amount ?? 0);

    return {
      availableBalance,
      pendingWithdraws: Number(pendingGross.toFixed(2)),
      lockedBalance: Number(pendingGross.toFixed(2)),
      netLockedBalance: Number(pendingNet.toFixed(2)),
    };
  }
  async transactions( cpf: string, userId?: string, page = '1', limit = '10', startDate?: string, endDate?: string, status?: string, description?: string, internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    const ownerFilter = this.buildOwnerFilter(cpf, userIds);
    if (!ownerFilter) {
      return { transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
    }

    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 10)), 5000);

    const andConditions: any[] = [
      ownerFilter,
      { description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' } },
    ];

    const statusUpper = status ? String(status).toUpperCase() : '';
    if (statusUpper && statusUpper !== 'ALL') {
      andConditions.push({ status: statusUpper as TxStatus });
    }

    if (description && description !== 'ALL') {
      andConditions.push({ description: { contains: description, mode: 'insensitive' } });
    }

    if (startDate || endDate) {
      const createdAt: any = {};
      if (startDate) createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
      andConditions.push({ createdAt });
    }

    const where = { AND: andConditions };

    const [totalItems, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      transactions: items.map((t) => {
        const netBase = Number(t.netAmount ?? t.amount);
        // TAXA_SERVICO (R$4 Sim Int Pay) — BOSQUE cobra a partir de 2026-05-29, igual à Renovada.
        const svcRaw = getPlatformTaxaEffective('BOSQUE', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);
        const taxaServico = svcRaw > 0 && t.createdAt >= BOSQUE_TAXA_SERVICO_DATE ? svcRaw : 0;
        return {
          id: t.id,
          userId: t.userId,
          amount: Number(t.amount),
          name: t.customerName ?? null,
          email: t.customerEmail ?? null,
          status: t.status,
          description: t.description ?? null,
          appliedGlobalFee: false,
          fee: Number(t.platformFee ?? 0),
          dom_fee: Number(t.domFee ?? 0),
          payment_method: t.paymentMethod,
          amountWithoutAllFee: Number((netBase - taxaServico).toFixed(2)),
          walletId: null,
          createdAt: t.createdAt,
          paymentId: t.domPaymentId ?? t.domTransactionId ?? null,
          updatedAt: t.updatedAt,
        };
      }),
      meta: {
        currentPage: pageNum,
        itemsPerPage: size,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / size)),
      },
    };
  }
  async withdrawals( cpf: string, userId?: string, page = '1', limit = '10', internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    if (userIds.length === 0) {
      return { withdrawals: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
    }
    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 10)), 200);

    const [totalItems, items] = await Promise.all([
      this.prisma.withdrawRequest.count({ where: { userId: { in: userIds }, pixKey: { not: BASELINE_PIXKEY } } }),
      this.prisma.withdrawRequest.findMany({
        where: { userId: { in: userIds }, pixKey: { not: BASELINE_PIXKEY } },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      withdrawals: items.map((w) => ({
        id: w.id,
        userId: w.userId,
        amount: Number(w.amount),
        status: w.status,
        pixKey: w.pixKey,
        rejectionReason: w.rejectionReason ?? null,
        createdAt: w.createdAt,
        user: { name: w.user?.name ?? '-', email: w.user?.email ?? '-' },
      })),
      meta: {
        currentPage: pageNum,
        itemsPerPage: size,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / size)),
      },
    };
  }
  async requestWithdraw( body: { cpf?: string; userId?: string; amount: number; pixKey: string }, internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByCpf(body.cpf ?? '', body.userId);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    const userId = userIds[0];
    // amount = valor bruto solicitado (o que sai do saldo). A taxa sai de DENTRO dele;
    // líquido (PIX) = bruto − taxa. Consistente com BosqueConfig.calcularTaxa(valorBruto),
    // com wallet.balance (bruto) e com o use-case canônico de saque.
    const taxaSaque = BosqueConfig.saque.calcularTaxa(amount);
    const grossAmount = parseFloat(amount.toFixed(2));
    const netAmount = parseFloat((amount - taxaSaque).toFixed(2));

    if (netAmount <= 0) {
      throw new BadRequestException(
        `O valor solicitado é insuficiente para cobrir a taxa (taxa: R$ ${taxaSaque.toFixed(2)})`,
      );
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new BadRequestException('Carteira não encontrada para este usuário');

    // Valida contra o disponível canônico (líquido desde o último saque), mesma
    // regra exibida no summary — evita sacar mais do que entrou de fato.
    const available = await this.computeAvailableSinceLastWithdrawal(userIds);
    if (available < grossAmount) {
      throw new BadRequestException(
        `Saldo insuficiente. Disponível: R$ ${available.toFixed(2)}, solicitado: R$ ${grossAmount.toFixed(2)}`,
      );
    }

    const created = await this.finance.createWithdrawal({ userId, amount: netAmount, grossAmount, fee: parseFloat(taxaSaque.toFixed(2)), pixKey: body.pixKey.trim(), platform: 'bosque', reserveWallet: true });

    return { success: true, id: created.id };
  }
  async zerarDisponivel( body: { userId?: string; email?: string; cpf?: string; reason?: string; valor?: number } = {}, internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const resolvedId = await this.resolveBosqueUserId(body);
    if (!resolvedId) {
      throw new BadRequestException('Conta do Bosque não encontrada. Informe userId, email ou cpf.');
    }

    await this.finance.ensureMaintenanceSafe(resolvedId, 'BOSQUE');
    const available = await this.computeAvailableSinceLastWithdrawal([resolvedId]);
    if (available <= 0.005) {
      return { success: true, message: 'O disponível já está zerado.', antes: Number(available.toFixed(2)), depois: 0 };
    }

    // valor opcional: abate só uma parte (o resto continua disponível). Sem valor, zera tudo.
    const abate = body.valor != null && Number.isFinite(Number(body.valor)) && Number(body.valor) > 0
      ? Math.min(Number(body.valor), available)
      : available;
    const valor = Number(abate.toFixed(2));
    const depois = Number((available - valor).toFixed(2));
    const created = await new PlatformMaintenanceService(this.prisma).baseline(resolvedId, 'BOSQUE', valor, BASELINE_PIXKEY, body.reason?.trim() || 'Baseline: zera o disponível do Bosque (vendas anteriores já liquidadas por fora).');

    return { success: true, baselineWithdrawId: created.id, antes: Number(available.toFixed(2)), abatido: valor, depois };
  }
  async inspectWallet( userId?: string, email?: string, cpf?: string, internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const resolvedId = await this.resolveBosqueUserId({ userId, email, cpf });
    if (!resolvedId) {
      return { accountExists: false, balance: 0, lockedBalance: 0, availableBalance: 0 };
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: resolvedId } });
    const balance = Number(wallet?.balance ?? 0);
    const locked = Number(wallet?.lockedBalance ?? 0);
    return {
      accountExists: !!wallet,
      userId: resolvedId,
      balance: Number(balance.toFixed(2)),
      lockedBalance: Number(locked.toFixed(2)),
      availableBalance: Number(Math.max(0, balance - locked).toFixed(2)),
    };
  }
  async fixBalance( body: {
      userId?: string;
      email?: string;
      cpf?: string;
      balance?: number;
      delta?: number;
      lockedBalance?: number;
      reason?: string;
    } = {}, internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);

    const hasBalance = body.balance !== undefined && body.balance !== null;
    // delta = 0 é no-op (vem assim no exemplo do Swagger) — trata como "não informado".
    const hasDelta = body.delta !== undefined && body.delta !== null && Number(body.delta) !== 0;
    const hasLocked = body.lockedBalance !== undefined && body.lockedBalance !== null;

    if (!hasBalance && !hasDelta && !hasLocked) {
      throw new BadRequestException('Informe "balance" (definir), "delta" (somar/subtrair) ou "lockedBalance".');
    }
    if (hasBalance && hasDelta) {
      throw new BadRequestException('Use apenas um: "balance" (definir) OU "delta" (somar/subtrair).');
    }

    const resolvedId = await this.resolveBosqueUserId(body);
    if (resolvedId) await this.finance.ensureMaintenanceSafe(resolvedId, 'BOSQUE');
    if (!resolvedId) {
      throw new BadRequestException('Conta do Bosque não encontrada. Informe userId, email ou cpf.');
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: resolvedId } });
    if (!wallet) {
      throw new BadRequestException('Carteira não encontrada para esta conta.');
    }

    const balanceBefore = Number(wallet.balance);
    const lockedBefore = Number(wallet.lockedBalance);

    let balanceAfter = balanceBefore;
    if (hasBalance) balanceAfter = Number(body.balance);
    else if (hasDelta) balanceAfter = balanceBefore + Number(body.delta);
    balanceAfter = Math.max(0, Number(balanceAfter.toFixed(2)));

    let lockedAfter = lockedBefore;
    if (hasLocked) lockedAfter = Math.max(0, Number(Number(body.lockedBalance).toFixed(2)));

    if (!Number.isFinite(balanceAfter) || !Number.isFinite(lockedAfter)) {
      throw new BadRequestException('Valores inválidos.');
    }

    const reason = body.reason?.trim() || 'Correção manual de saldo (Bosque/IBB)';

    await new PlatformMaintenanceService(this.prisma).correct(resolvedId, 'BOSQUE', { balance: balanceAfter, lockedBalance: lockedAfter, reason, action: 'ADMIN_BALANCE_FIX', metadata: { via: 'internal/bosque/finance/fix-balance' } });

    return {
      success: true,
      userId: resolvedId,
      before: {
        balance: Number(balanceBefore.toFixed(2)),
        lockedBalance: Number(lockedBefore.toFixed(2)),
        availableBalance: Number(Math.max(0, balanceBefore - lockedBefore).toFixed(2)),
      },
      after: {
        balance: Number(balanceAfter.toFixed(2)),
        lockedBalance: Number(lockedAfter.toFixed(2)),
        availableBalance: Number(Math.max(0, balanceAfter - lockedAfter).toFixed(2)),
      },
    };
  }
  async reconcile( userId?: string, email?: string, cpf?: string, internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const resolvedId = await this.resolveBosqueUserId({ userId, email, cpf });
    if (!resolvedId) {
      throw new BadRequestException('Conta do Bosque não encontrada. Informe userId, email ou cpf.');
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: resolvedId } });
    const balanceNow = Number(wallet?.balance ?? 0);
    const lockedNow = Number(wallet?.lockedBalance ?? 0);

    const completedWhere: any = {
      userId: resolvedId,
      status: 'COMPLETED',
      description: { contains: '[TENANT:BOSQUE]', mode: 'insensitive' },
    };

    const [creditsAgg, completedCount, nullNetCount, wdApproved, wdPending] = await Promise.all([
      this.prisma.transaction.aggregate({ where: completedWhere, _sum: { amount: true, netAmount: true } }),
      this.prisma.transaction.count({ where: completedWhere }),
      this.prisma.transaction.count({ where: { ...completedWhere, netAmount: null } }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId: resolvedId, status: { in: ['APPROVED', 'COMPLETED'] } },
        _sum: { grossAmount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId: resolvedId, status: 'PENDING' },
        _sum: { grossAmount: true },
      }),
    ]);

    const round = (n: number) => Number(n.toFixed(2));
    const grossCredits = Number(creditsAgg._sum.amount ?? 0);
    const netCredits = Number(creditsAgg._sum.netAmount ?? 0);
    const withdrawnApproved = Number(wdApproved._sum.grossAmount ?? 0);
    const pendingGross = Number(wdPending._sum.grossAmount ?? 0);

    const suggestedBalanceNet = round(netCredits - withdrawnApproved);
    const suggestedBalanceGross = round(grossCredits - withdrawnApproved);

    return {
      userId: resolvedId,
      walletExists: !!wallet,
      current: {
        balance: round(balanceNow),
        lockedBalance: round(lockedNow),
        availableBalance: round(Math.max(0, balanceNow - lockedNow)),
      },
      credits: {
        completedCount,
        transactionsWithoutNetAmount: nullNetCount,
        grossCredits: round(grossCredits),
        netCredits: round(netCredits),
      },
      withdrawals: {
        approvedGross: round(withdrawnApproved),
        pendingGross: round(pendingGross),
      },
      suggested: {
        net: {
          balance: suggestedBalanceNet,
          availableBalance: round(Math.max(0, suggestedBalanceNet - pendingGross)),
        },
        gross: {
          balance: suggestedBalanceGross,
          availableBalance: round(Math.max(0, suggestedBalanceGross - pendingGross)),
        },
      },
      note:
        'Somente leitura. Saldo atual é creditado BRUTO no sync/webhook. ' +
        'Se o correto for líquido, aplique suggested.net via POST /internal/bosque/finance/fix-balance.',
    };
  }
}
