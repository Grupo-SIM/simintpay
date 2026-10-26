import { assertExplicitPlatform } from '../../helpers/explicit-platform.helper';
import { getPlatformOwnerId } from '../../../modules/module.registry';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WithdrawStatus } from '@prisma/client';
import { BALANCE_LOG_REPOSITORY } from '../../../core/repositories/balance-log.repository.interface';
import { WITHDRAW_REPOSITORY } from '../../../core/repositories/withdraw.repository.interface';
import { CACHE_SERVICE } from '../../../core/services/cache.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type { ICacheService } from '../../../core/services/cache.interface';
import type { RequestWithdrawDto } from '../../dtos/withdraw/request-withdraw.dto';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleConfig } from '../../../modules/module.registry';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { ModuleRealtimeNotifyService } from '../../../infrastructure/realtime/module-realtime-notify.service';

@Injectable()
export class RequestWithdrawUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WITHDRAW_REPOSITORY)
    private readonly withdraws: IWithdrawRepository,
    @Inject(BALANCE_LOG_REPOSITORY)
    private readonly balanceLogs: IBalanceLogRepository,
    @Inject(CACHE_SERVICE) private readonly cache: ICacheService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly realtime: ModuleRealtimeNotifyService,
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
      include: {
        platform: true,
        ownedPlatforms: { select: { tag: true } },
        wallet: true,
      },
    });

    // Regras do módulo (ou fallback padrão)
    const selected = dto.platformTag ? [dto.platformTag] : user?.platform?.tag ? [user.platform.tag] : undefined;
    const moduleSlug = assertExplicitPlatform(user, selected)?.toLowerCase() ?? null;
    const renovadaId = (getPlatformOwnerId('RENOVADA') ?? '');
    const isRenovada = moduleSlug === 'renovada';
    const config = getModuleConfig(moduleSlug);
    const renovadaConfig = getModuleConfig('renovada');

    const minValor = isRenovada
      ? (renovadaConfig?.saque.minValor ?? getPlatformTaxaEffective('GLOBAL', 'SAQUE_MIN', 100))
      : (config?.saque.minValor ?? getPlatformTaxaEffective('GLOBAL', 'SAQUE_MIN', 100));
    const calcularTaxa = isRenovada && renovadaConfig
      ? (v: number) => renovadaConfig.saque.calcularTaxa(v)
      : config
        ? (v: number) => config.saque.calcularTaxa(v)
        : (v: number) => getPlatformTaxaEffective('GLOBAL', 'TAXA_SAQUE_FIXA', 2) + v * getPlatformTaxaEffective('GLOBAL', 'TAXA_SAQUE_PERCENT', 0);

    // Valor mínimo de saque
    if (dto.valor < minValor) {
      throw new UnprocessableEntityException(
        `O valor mínimo para saque é de R$ ${minValor.toFixed(2).replace('.', ',')}`,
      );
    }

    // Apenas um saque ativo por vez (somente PENDING bloqueia — APPROVED já foi processado)
    const activeWithdrawal = await this.prisma.withdrawRequest.findFirst({
      where: { userId, status: WithdrawStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (activeWithdrawal) {
      throw new ConflictException(
        `Você já possui uma solicitação de saque em andamento [ID: ${activeWithdrawal.id}, Status: ${activeWithdrawal.status}, Data: ${activeWithdrawal.createdAt.toISOString()}]. Aguarde a conclusão para solicitar outra.`,
      );
    }

    // [MODO SIMPAY SOBERANO] — Gerencia saldo local 
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    
    if (!wallet) throw new NotFoundException('Wallet não encontrada');

    const walletBalance = new Prisma.Decimal(wallet.balance.toString());
    const walletLocked = new Prisma.Decimal(wallet.lockedBalance.toString());

    const availableBalanceGross = walletBalance.sub(walletLocked);

    /** dto.valor = valor bruto do saque (ex.: 100). Taxa sobre o bruto; líquido PIX = bruto − taxa (ex.: 98). */
    const requestedGross = new Prisma.Decimal(dto.valor);

    if (requestedGross.toDP(2).gt(availableBalanceGross.toDP(2))) {
      throw new UnprocessableEntityException(
        `Saldo insuficiente para realizar o saque de R$ ${requestedGross.toFixed(2).replace('.', ',')}. Seu saldo disponível é R$ ${availableBalanceGross.toFixed(2).replace('.', ',')}`,
      );
    }

    const taxa = new Prisma.Decimal(calcularTaxa(requestedGross.toNumber()));
    const netAmount = requestedGross.sub(taxa);

    if (netAmount.lte(0)) {
      throw new UnprocessableEntityException(
        `O valor solicitado é insuficiente para cobrir as taxas (taxa: R$ ${taxa.toFixed(2).replace('.', ',')})`,
      );
    }

    const grossToDeduct = requestedGross;
    const amountToLock = grossToDeduct;

    const beforeLocked = walletLocked;
    const beforeBalance = walletBalance;

    // Cria o saque no banco local (status PENDING)
    let created;
    try {
      created = await this.withdraws.createWithWalletLock({
        userId,
        amount: netAmount.toNumber(),
        grossAmount: grossToDeduct.toNumber(),
        fee: taxa.toNumber(),
        pixKey: dto.chavePix,
        platform: moduleSlug,
        amountToLock: grossToDeduct.toNumber(),
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
      amount: new Prisma.Decimal(-amountToLock.toNumber()).toFixed(2),
      balanceBefore: beforeBalance.toFixed(2),
      balanceAfter: beforeBalance.toFixed(2),
      lockedBefore: beforeLocked.toFixed(2),
      lockedAfter: beforeLocked.add(amountToLock).toFixed(2),
      source: 'WITHDRAW',
      description: `Solicitação de saque${user?.platform ? ` — ${user.platform.name}` : ''}`,
    });

    await this.cache.delete(`wallet:${userId}`);
    await this.realtime.notifyWithdrawal(userId, { withdrawId: created.id });

    return {
      data: {
        id: created.id,
        valor: Number(created.amount) + Number(created.fee),
        valorBruto: Number(created.grossAmount),
        taxa: Number(created.fee),
        status: 'PENDENTE',
        chavePix: created.pixKey,
        modulo: user?.platform?.name ?? null,
      },
      message: 'Saque solicitado com sucesso',
    };
  }
}
