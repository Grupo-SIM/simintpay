import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BALANCE_LOG_REPOSITORY } from '../../../core/repositories/balance-log.repository.interface';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import { CACHE_SERVICE } from '../../../core/services/cache.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type { ICacheService } from '../../../core/services/cache.interface';
import type { RequestWithdrawDto } from '../../dtos/withdraw/request-withdraw.dto';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleConfig } from '../../../modules/module.registry';

// Fallback para usuários sem módulo configurado
const DEFAULT_MIN_VALOR = 100;
const DEFAULT_TAXA_FIXA = 2;

@Injectable()
export class RequestWithdrawUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WITHDRAW_REPOSITORY)
    private readonly withdraws: IWithdrawRepository,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
    @Inject(CACHE_SERVICE) private readonly cache: ICacheService,
  ) {}

  async execute(
    userId: string,
    dto: RequestWithdrawDto,
  ): Promise<{
    data: {
      id: string;
      valor: number;
      valorBruto: number;
      taxa: number;
      status: 'PENDENTE';
      chavePix: string;
      modulo: string | null;
    };
    message: string;
  }> {
    // Busca usuário com módulo
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        tenantModule: { select: { slug: true, name: true } },
      },
    });

    // Regras do módulo (ou fallback padrão)
    const moduleSlug = user?.tenantModule?.slug ?? null;
    const config = getModuleConfig(moduleSlug);

    const minValor = config?.saque.minValor ?? DEFAULT_MIN_VALOR;
    const calcularTaxa = config
      ? (v: number) => config.saque.calcularTaxa(v)
      : (v: number) => DEFAULT_TAXA_FIXA + v * 0;

    // Valor mínimo de saque
    if (dto.valor < minValor) {
      throw new UnprocessableEntityException(
        `O valor mínimo para saque é de R$ ${minValor.toFixed(2).replace('.', ',')}`,
      );
    }

    // Apenas um saque pendente por vez
    const pending = await this.withdraws.findPendingByUserId(userId);
    if (pending) {
      throw new ConflictException(
        'Você já possui um saque pendente. Aguarde a aprovação antes de solicitar um novo.',
      );
    }

    // Verifica saldo
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet não encontrada');

    const availableBalance = Number(wallet.balance) - Number(wallet.lockedBalance);

    if (dto.valor > availableBalance) {
      throw new UnprocessableEntityException(
        `Saldo insuficiente para realizar o saque de R$ ${dto.valor.toFixed(2).replace('.', ',')}`,
      );
    }

    const taxa = calcularTaxa(dto.valor);
    const netAmount = dto.valor - taxa;

    if (netAmount <= 0) {
      throw new UnprocessableEntityException(
        `O valor solicitado é insuficiente para cobrir as taxas (taxa: R$ ${taxa.toFixed(2).replace('.', ',')})`,
      );
    }

    const amountToLock = dto.valor;
    const beforeLocked = Number(wallet.lockedBalance);
    const beforeBalance = Number(wallet.balance);

    // Cria o saque no banco local (status PENDING)
    let created;
    try {
      created = await this.withdraws.createWithWalletLock({
        userId,
        amount: netAmount,
        grossAmount: dto.valor,
        fee: taxa,
        pixKey: dto.chavePix,
        amountToLock,
        currentWalletVersion: wallet.version,
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes('Wallet version conflict')) {
        throw new UnprocessableEntityException(
          'Conflito ao atualizar wallet. Tente novamente.',
        );
      }
      throw e;
    }

    await this.balanceLogs.create({
      userId,
      action: 'WITHDRAW_REQUESTED',
      amount: new Prisma.Decimal(-amountToLock).toFixed(2),
      balanceBefore: new Prisma.Decimal(beforeBalance).toFixed(2),
      balanceAfter: new Prisma.Decimal(beforeBalance).toFixed(2),
      lockedBefore: new Prisma.Decimal(beforeLocked).toFixed(2),
      lockedAfter: new Prisma.Decimal(beforeLocked + amountToLock).toFixed(2),
      source: 'WITHDRAW',
      description: `Solicitação de saque${user?.tenantModule ? ` — ${user.tenantModule.name}` : ''}`,
    });

    await this.cache.delete(`wallet:${userId}`);

    return {
      data: {
        id: created.id,
        valor: Number(created.amount),
        valorBruto: Number(created.grossAmount),
        taxa: Number(created.fee),
        status: 'PENDENTE',
        chavePix: created.pixKey,
        modulo: user?.tenantModule?.name ?? null,
      },
      message: 'Saque solicitado com sucesso',
    };
  }
}
