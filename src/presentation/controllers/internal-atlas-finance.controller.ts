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
import { AtlasConfig } from '../../modules/atlas/atlas.config';

type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'EXPIRED' | 'DRAFT';

@Controller('internal/atlas/finance')
export class InternalAtlasFinanceController {
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

    // Se não encontrou por CPF nem ID direto, tenta buscar o usuário padrão do Atlas
    if (ids.size === 0) {
      const atlasId = process.env.ATLAS_USER_ID;
      if (atlasId) ids.add(atlasId);
    }

    return [...ids];
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
      return { availableBalance: 0, pendingWithdraws: 0, lockedBalance: 0 };
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
      availableBalance: Math.max(0, Number((balanceNet - lockedNet).toFixed(2))),
      pendingWithdraws: Number(pendingGross.toFixed(2)),
      lockedBalance: Number(lockedNet.toFixed(2)),
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
    
    // Calcula taxas baseadas no AtlasConfig
    const fee = parseFloat(AtlasConfig.saque.calcularTaxa(amount).toFixed(2));
    const grossAmount = amount; 
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

    const created = await this.prisma.$transaction(async (tx) => {
      const wr = await tx.withdrawRequest.create({
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
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { increment: grossAmount }, version: { increment: 1 } },
      });
      return wr;
    });

    return { success: true, id: created.id, netPayout };
  }
}
