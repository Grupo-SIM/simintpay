import { PlatformFinanceService } from './platform-finance.service';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { RenovadaConfig } from '../../../modules/renovada/renovada.config';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { ORIGEM_MAQUINETA_TAG } from '../../../application/utils/internal-tags.util';

const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-29T20:40:00.000Z');

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Injectable()
export class InternalRenovadaFinanceService {
  constructor(private readonly prisma: PrismaService, private readonly finance: PlatformFinanceService) {}


  private normalizeCpf(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private cpfVariants(raw: string): string[] {
    const cpf = this.normalizeCpf(raw);
    if (!cpf || cpf.length !== 11) return [];
    return [cpf, cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
  }

  private resolveUserIdsByCpf(cpf: string, directUserId?: string): Promise<string[]> {
    return this.finance.resolveAccountIds({ document: cpf, userId: directUserId, allowCnpj: false });
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
  async summary( cpf: string, userId?: string, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);

    if (userIds.length === 0) {
      return { availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 };
    }

    // wallet.balance stores net (DOM liquid_amount). Approved withdrawals are already deducted
    // from wallet.balance at approval time. lockedBalance tracks pending withdrawal gross.
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId: { in: userIds } },
    });
    const balanceNet = Number(wallet?.balance ?? 0);
    const lockedNet = Number(wallet?.lockedBalance ?? 0);

    const wdPending = await this.prisma.withdrawRequest.aggregate({
      where: { userId: { in: userIds }, status: 'PENDING' },
      _sum: { grossAmount: true, amount: true },
    });
    const pendingGross = Number(wdPending._sum.grossAmount ?? wdPending._sum.amount ?? 0);

    return {
      availableBalance: Math.max(0, Number((balanceNet - lockedNet).toFixed(2))),
      pendingWithdraws: Number(pendingGross.toFixed(2)),
      lockedBalance: Number(lockedNet.toFixed(2)),
    };
  }
  async transactions( cpf: string, userId?: string, page = '1', limit = '10', startDate?: string, endDate?: string, status?: string, description?: string, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    const ownerFilter = this.buildOwnerFilter(cpf, userIds);
    if (!ownerFilter) {
      return { transactions: [], meta: { currentPage: 1, itemsPerPage: 10, totalItems: 0, totalPages: 1 } };
    }

    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 10)), 5000);

    const andConditions: any[] = [
      ownerFilter,
      { description: { contains: '[TENANT:RENOVADA]', mode: 'insensitive' } },
      // Transações de maquineta têm página própria (/admin/machines); não devem
      // aparecer na listagem de Ofertas App, mesmo estando sincronizadas na carteira.
      { NOT: { description: { contains: ORIGEM_MAQUINETA_TAG, mode: 'insensitive' } } },
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

    const svcRaw = getPlatformTaxaEffective('RENOVADA', 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);

    return {
      transactions: items.map((t) => {
        const netBase = Number(t.netAmount ?? t.amount);
        const taxaServico = svcRaw > 0 && t.createdAt >= TAXA_SERVICO_EFFECTIVE_DATE ? svcRaw : 0;
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
    const userIds = await this.resolveUserIdsByCpf(cpf, userId);
    return this.finance.legacyWithdrawals(userIds, page, limit);
  }
  async requestWithdraw( body: { cpf?: string; userId?: string; amount: number; pixKey: string }, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByCpf(body.cpf ?? '', body.userId);
    if (userIds.length === 0) throw new BadRequestException('Nenhuma conta encontrada');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    const userId = userIds[0];
    // Fee is deducted FROM the entered amount (not added on top).
    // amount = total deducted from balance; user receives amount - fee.
    const fee = parseFloat(RenovadaConfig.saque.calcularTaxa(amount).toFixed(2));
    const grossAmount = amount; // amount entered = total locked/deducted
    const netPayout = parseFloat((amount - fee).toFixed(2));

    if (netPayout <= 0) {
      throw new BadRequestException(`Valor insuficiente para cobrir a taxa de R$ ${fee.toFixed(2)}`);
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new BadRequestException('Carteira não encontrada para este usuário');

    const available = parseFloat((Number(wallet.balance) - Number(wallet.lockedBalance)).toFixed(2));
    if (available < grossAmount) {
      throw new BadRequestException(
        `Saldo insuficiente. Disponível: R$ ${available.toFixed(2)}, solicitado: R$ ${grossAmount.toFixed(2)}`,
      );
    }

    const created = await this.finance.createWithdrawal({ userId, amount: netPayout, grossAmount, fee, pixKey: body.pixKey.trim(), platform: 'renovada', reserveWallet: true });

    return { success: true, id: created.id, netPayout };
  }
}
