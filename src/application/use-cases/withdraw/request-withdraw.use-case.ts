import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BALANCE_LOG_REPOSITORY } from '../../../core/repositories/balance-log.repository.interface';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { CACHE_SERVICE } from '../../../core/services/cache.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type {
  IPaymentGateway,
  DomRequestWithdrawOutput,
} from '../../../core/services/payment-gateway.interface';
import type { ICacheService } from '../../../core/services/cache.interface';
import type { RequestWithdrawDto } from '../../dtos/withdraw/request-withdraw.dto';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

const FEE = 2;
const NET_PERCENT = 0.91;

@Injectable()
export class RequestWithdrawUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WITHDRAW_REPOSITORY)
    private readonly withdraws: IWithdrawRepository,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(CACHE_SERVICE) private readonly cache: ICacheService,
  ) {}

  private async requestOnDom(input: {
    domToken: string;
    dto: RequestWithdrawDto;
  }): Promise<DomRequestWithdrawOutput> {
    return this.gateway.requestWithdraw(input.domToken, {
      amount: input.dto.valor,
      pixKey: input.dto.chavePix,
    });
  }

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
    };
    message: string;
  }> {
    const pending = await this.withdraws.findPendingByUserId(userId);
    if (pending) {
      throw new ConflictException(
        'Você já possui um saque pendente. Aguarde a aprovação antes de solicitar um novo.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { domToken: true },
    });

    if (!user?.domToken) {
      throw new UnauthorizedException('Usuário não autenticado na api-dom');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });
    if (!wallet) throw new NotFoundException('Wallet não encontrada');

    const balance = Number(wallet.balance);
    const locked = Number(wallet.lockedBalance);
    const availableBalance = balance - locked;

    if (dto.valor > availableBalance - FEE) {
      throw new UnprocessableEntityException(
        'Saldo insuficiente para saque (considere a taxa de R$ 2,00)',
      );
    }

    const domRes = await this.requestOnDom({ domToken: user.domToken, dto });

    const amountToLock = dto.valor;

    const beforeLocked = Number(wallet.lockedBalance);
    const beforeBalance = Number(wallet.balance);

    let created;

    try {
      created = await this.withdraws.createWithWalletLock({
        userId,
        amount: domRes.netAmount,
        grossAmount: dto.valor,
        fee: domRes.fee,
        pixKey: dto.chavePix,
        domWithdrawId: domRes.requestId,
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

    const afterLocked = beforeLocked + amountToLock;

    await this.balanceLogs.create({
      userId,
      action: 'WITHDRAW_REQUESTED',
      amount: new Prisma.Decimal(-amountToLock).toFixed(2),
      balanceBefore: new Prisma.Decimal(beforeBalance).toFixed(2),
      balanceAfter: new Prisma.Decimal(beforeBalance).toFixed(2),
      lockedBefore: new Prisma.Decimal(beforeLocked).toFixed(2),
      lockedAfter: new Prisma.Decimal(afterLocked).toFixed(2),
      source: 'WITHDRAW',
      description: 'Solicitação de saque',
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
      },
      message: 'Saque solicitado com sucesso',
    };
  }
}
