import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { AtlasConfig } from '../../modules/atlas/atlas.config';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Controller('internal/atlas/finance')
export class InternalAtlasFinanceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    return { status: 'ok', service: 'atlas-finance-internal' };
  }

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private async resolveUserIds(input: { cpf?: string; email?: string; userId?: string }): Promise<string[]> {
    const ids = new Set<string>();

    if (input.email?.trim()) {
      const user = await this.prisma.user.findUnique({
        where: { email: input.email.trim() },
        select: { id: true },
      });
      if (user) ids.add(user.id);
    }

    const clean = this.normalizeDoc(input.cpf ?? '');
    if (clean.length === 14) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = await (this.prisma.user as any).findMany({
        where: { cnpj: clean },
        select: { id: true },
      });
      (users as any[]).forEach((u: any) => ids.add(u.id));
    } else if (clean.length === 11) {
      const variants = [clean, clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')];
      const users = await this.prisma.user.findMany({
        where: { cpf: { in: variants } },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (input.userId?.trim()) {
      ids.add(input.userId.trim());
    }

    return [...ids];
  }

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Query('email') email?: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
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

  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf?: string; email?: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    
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
    const created = await this.prisma.withdrawRequest.create({
      data: {
        userId,
        amount: netPayout,
        grossAmount,
        fee,
        status: 'PENDING',
        pixKey: body.pixKey.trim(),
        platform: 'atlas',
      },
    });

    return { success: true, id: created.id, netPayout };
  }

  @Get('withdraw/:id')
  async getWithdrawStatus(
    @Param('id') id: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
      select: { id: true, status: true, rejectionReason: true },
    });
    if (!withdraw) throw new NotFoundException('Saque não encontrado');
    return withdraw;
  }
}
