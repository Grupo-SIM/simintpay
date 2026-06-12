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
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const AREAFLIX_WITHDRAW_MIN = Number(process.env.AREAFLIX_WITHDRAW_MIN || 100);
const AREAFLIX_WITHDRAW_FEE = Number(process.env.AREAFLIX_WITHDRAW_FEE || 2);

/**
 * Endpoints internos consumidos pelo saas-netflix-back (areaflix).
 * Espelha o padrão do internal-pagatg-finance: resolução de conta por CPF/CNPJ
 * e saques que entram na fila de aprovação do painel admin do simpay.
 */
@Controller('internal/areaflix/finance')
export class InternalAreaflixFinanceController {
  constructor(private readonly prisma: PrismaService) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private async resolveUserIdsByDoc(doc: string): Promise<string[]> {
    const ids = new Set<string>();
    const clean = this.normalizeDoc(doc);

    if (clean.length === 14) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = await (this.prisma.user as any).findMany({
        where: { cnpj: clean },
        select: { id: true },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (users as any[]).forEach((u: any) => ids.add(u.id));
    } else if (clean.length === 11) {
      const variants = [clean, clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
      const users = await this.prisma.user.findMany({
        where: { cpf: { in: variants } },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    return [...ids];
  }

  /** Verifica se existe conta simpay com o CPF/CNPJ informado (para liberar saques). */
  @Get('account')
  async accountStatus(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(cpf);
    return {
      accountExists: userIds.length > 0,
      minimumWithdrawalAmount: AREAFLIX_WITHDRAW_MIN,
      withdrawalFeeBrl: AREAFLIX_WITHDRAW_FEE,
    };
  }

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { withdrawals: [], meta: { currentPage: 1, itemsPerPage: 20, totalItems: 0, totalPages: 1 } };
    }
    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 20)), 200);

    const where = { userId: { in: userIds }, platform: 'areaflix' };

    const [totalItems, items] = await Promise.all([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      withdrawals: items.map((w) => ({
        id: w.id,
        amount: Number(w.amount),
        grossAmount: Number(w.grossAmount),
        fee: Number(w.fee),
        status: w.status,
        pixKey: w.pixKey,
        rejectionReason: w.rejectionReason ?? null,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      meta: {
        currentPage: pageNum,
        itemsPerPage: size,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / size)),
      },
    };
  }

  /** Soma de saques ativos/concluídos (para o cálculo de saldo no lado areaflix). */
  @Get('withdrawals/totals')
  async withdrawalTotals(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { pendingGross: 0, completedGross: 0 };
    }

    const [pending, completed] = await Promise.all([
      this.prisma.withdrawRequest.aggregate({
        where: { userId: { in: userIds }, platform: 'areaflix', status: 'PENDING' },
        _sum: { grossAmount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId: { in: userIds }, platform: 'areaflix', status: { in: ['APPROVED', 'COMPLETED'] } },
        _sum: { grossAmount: true },
      }),
    ]);

    return {
      pendingGross: Number(pending._sum.grossAmount ?? 0),
      completedGross: Number(completed._sum.grossAmount ?? 0),
    };
  }

  /** Cria solicitação de saque — entra na fila do painel admin do simpay (platform: areaflix). */
  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const userIds = await this.resolveUserIdsByDoc(body.cpf);
    if (userIds.length === 0) {
      throw new BadRequestException('Nenhuma conta simintpay encontrada para este CPF/CNPJ');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (amount < AREAFLIX_WITHDRAW_MIN) {
      throw new BadRequestException(`Valor mínimo para saque é de R$ ${AREAFLIX_WITHDRAW_MIN.toFixed(2)}`);
    }
    if (!body.pixKey?.trim()) throw new BadRequestException('Chave PIX é obrigatória');

    // Apenas um saque pendente por vez
    const active = await this.prisma.withdrawRequest.findFirst({
      where: { userId: { in: userIds }, platform: 'areaflix', status: 'PENDING' },
    });
    if (active) {
      throw new BadRequestException('Já existe uma solicitação de saque em andamento. Aguarde a conclusão.');
    }

    const created = await this.prisma.withdrawRequest.create({
      data: {
        userId: userIds[0],
        amount,
        grossAmount: parseFloat((amount + AREAFLIX_WITHDRAW_FEE).toFixed(2)),
        fee: parseFloat(AREAFLIX_WITHDRAW_FEE.toFixed(2)),
        status: 'PENDING',
        pixKey: body.pixKey.trim(),
        platform: 'areaflix',
      },
    });

    return { success: true, id: created.id };
  }
}
