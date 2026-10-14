import { hasPlatformMarker } from '../../platform-core/platform-sync.adapter';
import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

/** Imports share one atomic ledger writer. Wallet credit is explicit, never inferred from status. */
export class PlatformLedger {
  constructor(private readonly prisma: PrismaService) {}

  async record(tag: string, data: Prisma.TransactionUncheckedCreateInput, creditWallet = false, expectedOwnerUserId?: string) {
    const reference = data.domPaymentId;
    if (!reference || !hasPlatformMarker(data.description ?? '', tag)) throw new BadRequestException('Referência e plataforma obrigatórias');
    const amount = new Prisma.Decimal(data.amount as Prisma.Decimal.Value);
    const net = new Prisma.Decimal((data.netAmount ?? data.amount) as Prisma.Decimal.Value);
    if (!amount.isFinite() || amount.lte(0) || !net.isFinite() || net.lt(0) || net.gt(amount)) throw new BadRequestException('Valor inválido');
    const replay = (row: any) => {
      if (!hasPlatformMarker(row.description ?? '', tag) || row.userId !== data.userId || !new Prisma.Decimal(row.amount).eq(amount) || !new Prisma.Decimal(row.netAmount ?? row.amount).eq(net)) {
        throw new ConflictException({ code: 'LEDGER_REFERENCE_CONFLICT', message: 'Referência já vinculada a outro lançamento' });
      }
      return { success: true, id: row.id, created: false };
    };
    try {
      return await this.prisma.$transaction(async p => {
        const platform = await p.platform.findUnique({ where: { tag }, include: { owner: true } });
        if (!platform?.isActive || !platform.owner?.isActive || platform.owner.isPurged) throw new UnprocessableEntityException({ code: 'PLATFORM_UNAVAILABLE' });
        if (expectedOwnerUserId && platform.ownerUserId !== expectedOwnerUserId) throw new ConflictException({ code: 'PLATFORM_OWNER_CHANGED' });
        if (platform.acquirer !== 'DOM') throw new UnprocessableEntityException({ code: 'ACQUIRER_OPERATION_UNSUPPORTED' });
        const existing = await p.transaction.findUnique({ where: { domPaymentId: reference } });
        if (existing) return replay(existing);
        const user = await p.user.findUnique({ where: { id: data.userId }, select: { isActive: true, isPurged: true } });
        if (!user?.isActive || user.isPurged) throw new UnprocessableEntityException({ code: 'ACCOUNT_UNAVAILABLE' });
        const row = await p.transaction.create({ data: { ...data, amount, netAmount: net, acquirer: platform.acquirer } });
        if (creditWallet) {
          if (data.status !== 'COMPLETED') throw new BadRequestException('Crédito exige lançamento concluído');
          await p.wallet.upsert({ where: { userId: data.userId }, update: { balance: { increment: net }, updatedAt: new Date() }, create: { userId: data.userId, balance: net, lockedBalance: 0 } });
        }
        return { success: true, id: row.id, created: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const winner = await this.prisma.transaction.findUnique({ where: { domPaymentId: reference } });
      if (!winner) throw error;
      return replay(winner);
    }
  }
}
