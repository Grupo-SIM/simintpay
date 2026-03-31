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

// Fallback para usuários sem módulo configurado
const DEFAULT_MIN_VALOR = Number(process.env.DEFAULT_WITHDRAW_MIN_VALUE || 100);
const DEFAULT_TAXA_FIXA = Number(process.env.DEFAULT_WITHDRAW_FIXED_FEE || 2);
const DEFAULT_TAXA_PERCENT = Number(process.env.DEFAULT_WITHDRAW_PERCENT_FEE || 0);

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
        tenantModule: true,
        wallet: true,
      },
    });

    // Regras do módulo (ou fallback padrão)
    const moduleSlug = user?.tenantModule?.slug ?? null;
    const renovadaId = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const isRenovada = moduleSlug === 'renovada' || userId === renovadaId;
    const config = getModuleConfig(moduleSlug);
    const renovadaConfig = getModuleConfig('renovada');

    const minValor = isRenovada
      ? (renovadaConfig?.saque.minValor ?? DEFAULT_MIN_VALOR)
      : (config?.saque.minValor ?? DEFAULT_MIN_VALOR);
    const calcularTaxa = isRenovada && renovadaConfig
      ? (v: number) => renovadaConfig.saque.calcularTaxa(v)
      : config
        ? (v: number) => config.saque.calcularTaxa(v)
        : (v: number) => DEFAULT_TAXA_FIXA + v * DEFAULT_TAXA_PERCENT;

    // Valor mínimo de saque
    if (dto.valor < minValor) {
      throw new UnprocessableEntityException(
        `O valor mínimo para saque é de R$ ${minValor.toFixed(2).replace('.', ',')}`,
      );
    }

    // Apenas um saque ativo por vez (PENDING ou APPROVED)
    const activeWithdrawal = await this.prisma.withdrawRequest.findFirst({
      where: { userId, status: { in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED] } },
      orderBy: { createdAt: 'desc' },
    });
    if (activeWithdrawal) {
      throw new ConflictException(
        `Você já possui uma solicitação de saque em andamento [ID: ${activeWithdrawal.id}, Status: ${activeWithdrawal.status}, Data: ${activeWithdrawal.createdAt.toISOString()}]. Aguarde a conclusão para solicitar outra.`,
      );
    }

    // [MODO SIMPAY SOBERANO] — Gerencia saldo local 
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    
    // Se estiver em desenvolvimento e não houver wallet,Provisionamos para o teste real fluir
    if (!wallet && process.env.NODE_ENV === 'development') {
      console.log(`[SIMPAY DEV] Auto-provisionando usuário e carteira para o ID: ${userId}`);
      
      const email = user?.email || `cliente-${userId.substring(0, 8)}@simpay.com`;
      const name = user?.name || 'Cliente Renovada Sincronizado';

      // Garante que o usuário existe
      await this.prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          email,
          name,
          password: 'password-dev',
        }
      });

      // Cria carteira com saldo para permitir os testes de fluxo
      wallet = await this.prisma.wallet.create({
        data: {
          userId,
          balance: 10000.00, // Saldo inicial de teste (Real)
          lockedBalance: 0,
        }
      });
    }

    if (!wallet) throw new NotFoundException('Wallet não encontrada');

    const walletBalance = new Prisma.Decimal(wallet.balance.toString());
    const walletLocked = new Prisma.Decimal(wallet.lockedBalance.toString());

    const availableBalanceGross = walletBalance.sub(walletLocked);

    const fatorRenovada = new Prisma.Decimal(
      renovadaConfig?.saque.fatorLiquidez ?? process.env.RENOVADA_LIQUIDEZ ?? 0.91,
    );

    /** Renovada: dto.valor = compromisso em saldo líquido (net); lock na wallet em bruto = valor/fator */
    const valorLiquidoComprometido = new Prisma.Decimal(dto.valor);
    const grossToLockRenovada = isRenovada
      ? valorLiquidoComprometido.div(fatorRenovada)
      : new Prisma.Decimal(0);
    const requestedGross = isRenovada ? grossToLockRenovada : new Prisma.Decimal(dto.valor);

    if (isRenovada) {
      const availableGross = walletBalance.sub(walletLocked);
      const availableNet = availableGross.mul(fatorRenovada);
      if (valorLiquidoComprometido.toDP(2).gt(availableNet.toDP(2))) {
        throw new UnprocessableEntityException(
          `Saldo insuficiente para realizar o saque de R$ ${valorLiquidoComprometido.toFixed(2).replace('.', ',')} (líquido). Seu saldo líquido disponível é R$ ${availableNet.toFixed(2).replace('.', ',')}`,
        );
      }
    } else if (requestedGross.toDP(2).gt(availableBalanceGross.toDP(2))) {
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
      description: `Solicitação de saque${user?.tenantModule ? ` — ${user.tenantModule.name}` : ''}`,
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
        modulo: user?.tenantModule?.name ?? null,
      },
      message: 'Saque solicitado com sucesso',
    };
  }
}
