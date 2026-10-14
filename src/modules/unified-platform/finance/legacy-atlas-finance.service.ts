import { PlatformFinanceService } from './platform-finance.service';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { AtlasConfig } from '../../../modules/atlas/atlas.config';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Injectable()
export class InternalAtlasFinanceService {
  constructor(private readonly prisma: PrismaService, private readonly finance: PlatformFinanceService) {}
  async health() {
    return { status: 'ok', service: 'atlas-finance-internal' };
  }


  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private resolveUserIds(input: { cpf?: string; email?: string; userId?: string }): Promise<string[]> {
    return this.finance.resolveAccountIds({ document: input.cpf, email: input.email, userId: input.userId });
  }
  async summary( cpf: string, email?: string, userId?: string, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIds({ cpf, email, userId });

    if (userIds.length === 0) {
      return { userExists: false, availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 };
    }

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
      userExists: true,
      availableBalance: Math.max(0, Number((balanceNet - lockedNet).toFixed(2))),
      pendingWithdraws: Number(pendingGross.toFixed(2)),
      lockedBalance: Number(lockedNet.toFixed(2)),
    };
  }
  async requestWithdraw( body: { cpf?: string; email?: string; userId?: string; amount: number; pixKey: string }, internalToken?: string,
  ) {
    
    const userIds = await this.resolveUserIds({ 
      cpf: body.cpf, 
      email: body.email, 
      userId: body.userId 
    });

    if (userIds.length === 0) {
      throw new BadRequestException(
        'Usuário não encontrado na SimPay. Por favor, crie uma conta na SimPay com este e-mail/CPF para poder solicitar saques.'
      );
    }

    const userId = userIds[0];
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (!body.pixKey?.trim()) throw new BadRequestException('PIX é obrigatório');

    // Calcula taxas baseadas no AtlasConfig
    const fee = parseFloat(AtlasConfig.saque.calcularTaxa(amount).toFixed(2));
    const grossAmount = amount; 
    const netPayout = parseFloat((amount - fee).toFixed(2));

    if (netPayout <= 0) {
      throw new BadRequestException(`Valor insuficiente para cobrir a taxa de R$ ${fee.toFixed(2)}`);
    }

    // Criar o withdrawRequest vinculado ao usuário REAL
    // A SimPay não valida o saldo para a plataforma Atlas (conforme regra de negócio)
    const created = await this.finance.createWithdrawal({ userId, amount: netPayout, grossAmount, fee, pixKey: body.pixKey.trim(), platform: 'atlas' });

    return { success: true, id: created.id, netPayout };
  }
  async getWithdrawStatus( id: string, internalToken?: string,
  ) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
      select: { id: true, status: true, rejectionReason: true },
    });
    if (!withdraw) throw new NotFoundException('Saque não encontrado');
    return withdraw;
  }
}
