import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { BosqueConfig } from '../../modules/bosque/bosque.config';
import { computeBosqueAvailableSinceLastWithdrawal } from '../../application/helpers/bosque-available.helper';
import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

/** BOSQUE passou a cobrar TAXA_SERVICO (R$4 Sim Int Pay) a partir de 2026-05-29 — mesma data da Renovada. */
const BOSQUE_TAXA_SERVICO_DATE = new Date('2026-05-29T20:40:00.000Z');

/**
 * pixKey usado no registro de "baseline" (POST /zerar-disponivel) — um saque sintético
 * que representa vendas antigas já liquidadas por fora, zerando o disponível a partir de
 * agora. É contado pelo cálculo do disponível (para zerar), mas escondido do histórico.
 */
const BASELINE_PIXKEY = 'BASELINE_SALDO';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Controller('internal/bosque/finance')
export class InternalBosqueFinanceController {
  constructor(private readonly prisma: PrismaService) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
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

    const envId = process.env.BOSQUE_ID?.trim();
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

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
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

  @Get('transactions')
  async transactions(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
    @Headers('x-internal-token') internalToken?: string,
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

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Headers('x-internal-token') internalToken?: string,
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

  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf?: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
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

    const created = await this.prisma.$transaction(async (tx) => {
      const wr = await tx.withdrawRequest.create({
        data: {
          userId,
          amount: netAmount,
          grossAmount,
          fee: parseFloat(taxaSaque.toFixed(2)),
          status: 'PENDING',
          pixKey: body.pixKey.trim(),
          platform: 'bosque',
        },
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { increment: grossAmount }, version: { increment: 1 } },
      });
      return wr;
    });

    return { success: true, id: created.id };
  }

  /**
   * Zera o saldo DISPONÍVEL do Bosque AGORA (baseline), sem apagar histórico e sem
   * afetar vendas futuras. Cria um "saque" sintético (COMPLETED, pixKey=BASELINE_SALDO)
   * do valor disponível atual — o cálculo do disponível subtrai esse valor e passa a 0,
   * enquanto novas vendas continuam somando normalmente. O registro fica escondido do
   * histórico e é reversível (basta excluí-lo).
   *
   * Use quando o disponível mostra um resíduo de vendas antigas já pagas por fora
   * (sem solicitação de saque registrada).
   */
  @Post('zerar-disponivel')
  @ApiOperation({ summary: 'Zera (ou abate um valor de) o disponível do Bosque agora (baseline), mantendo vendas futuras' })
  async zerarDisponivel(
    @Body() body: { userId?: string; email?: string; cpf?: string; reason?: string; valor?: number } = {},
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const resolvedId = await this.resolveBosqueUserId(body);
    if (!resolvedId) {
      throw new BadRequestException('Conta do Bosque não encontrada. Informe userId, email ou cpf.');
    }

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
    const created = await this.prisma.$transaction(async (tx) => {
      const wr = await tx.withdrawRequest.create({
        data: {
          userId: resolvedId,
          amount: valor,
          grossAmount: valor,
          fee: 0,
          status: 'COMPLETED',
          pixKey: BASELINE_PIXKEY,
          platform: 'bosque-baseline',
        },
      });
      await tx.balanceLog.create({
        data: {
          userId: resolvedId,
          action: 'BOSQUE_BASELINE_ZERO',
          amount: -valor,
          balanceBefore: 0,
          balanceAfter: 0,
          lockedBefore: 0,
          lockedAfter: 0,
          source: 'MASTER_ADMIN_CONTROL',
          description: body.reason?.trim() || 'Baseline: zera o disponível do Bosque (vendas anteriores já liquidadas por fora).',
          metadata: { platform: 'bosque', via: 'internal/bosque/finance/zerar-disponivel', valorZerado: valor, baselineId: 'pending' },
        },
      });
      return wr;
    });

    return { success: true, baselineWithdrawId: created.id, antes: Number(available.toFixed(2)), abatido: valor, depois };
  }

  /**
   * Inspeciona a carteira do Bosque (saldo bruto, travado e disponível).
   * Útil para conferir antes de corrigir.
   */
  @Get('wallet')
  async inspectWallet(
    @Query('userId') userId?: string,
    @Query('email') email?: string,
    @Query('cpf') cpf?: string,
    @Headers('x-internal-token') internalToken?: string,
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

  /**
   * Corrige manualmente o saldo da carteira do Bosque (IBB).
   * - `balance`: define o saldo exato (ex.: 0 depois de sacar tudo).
   * - `delta`: alternativa — soma/subtrai do saldo atual.
   * - `lockedBalance` (opcional): corrige o valor travado preso por um saque.
   * Tudo fica registrado no BalanceLog (before/after) para auditoria.
   */
  @Post('fix-balance')
  @ApiOperation({ summary: 'Corrige manualmente o saldo da carteira do Bosque (IBB)' })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          example: 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c',
          description: 'ID da conta do Bosque. Se omitido, usa o BOSQUE_ID do ambiente.',
        },
        email: { type: 'string', example: 'contato@bosque.com.br' },
        balance: {
          type: 'number',
          example: 0,
          description: 'Define o saldo EXATO (R$). Use este campo para inserir o valor correto.',
        },
        delta: { type: 'number', description: 'Alternativa ao balance: soma (+) / subtrai (-) do saldo atual.' },
        lockedBalance: { type: 'number', description: 'Opcional: corrige o valor travado por saque pendente.' },
        reason: { type: 'string', example: 'Correção manual após troca de API' },
      },
    },
  })
  async fixBalance(
    @Body() body: {
      userId?: string;
      email?: string;
      cpf?: string;
      balance?: number;
      delta?: number;
      lockedBalance?: number;
      reason?: string;
    } = {},
    @Headers('x-internal-token') internalToken?: string,
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

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: balanceAfter,
          lockedBalance: lockedAfter,
          version: { increment: 1 },
        },
      });
      await tx.balanceLog.create({
        data: {
          userId: resolvedId,
          action: 'ADMIN_BALANCE_FIX',
          amount: Number((balanceAfter - balanceBefore).toFixed(2)),
          balanceBefore,
          balanceAfter,
          lockedBefore,
          lockedAfter,
          source: 'MASTER_ADMIN_CONTROL',
          description: reason,
          metadata: { platform: 'bosque', via: 'internal/bosque/finance/fix-balance' },
        },
      });
    });

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

  /**
   * SOMENTE LEITURA. Recalcula qual deveria ser o saldo do Bosque a partir das
   * fontes canônicas — transações BOSQUE concluídas (crédito) e saques aprovados
   * (débito) — e mostra o resultado em base BRUTA e LÍQUIDA, comparado ao saldo
   * atual. Não altera nada: use o POST /fix-balance para aplicar o valor escolhido.
   *
   * Obs.: hoje o sync/webhook creditam o saldo pelo valor BRUTO (amount). Se o
   * correto for o líquido (amount × liquidez), o resíduo acumulado das taxas é o
   * que infla o saldo — compare `suggested.net` com o `current`.
   */
  @Get('reconcile')
  async reconcile(
    @Query('userId') userId?: string,
    @Query('email') email?: string,
    @Query('cpf') cpf?: string,
    @Headers('x-internal-token') internalToken?: string,
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
