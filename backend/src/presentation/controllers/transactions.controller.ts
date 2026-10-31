import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListTransactionsQueryDto } from '../../application/dtos/transactions/list-transactions.query.dto';
import { ListTransactionsUseCase } from '../../application/use-cases/transactions/list-transactions.use-case';
import { GetTransactionDetailsUseCase } from '../../application/use-cases/transactions/get-transaction-details.use-case';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { canonicalTransactionPlatformTag } from '../../modules/platform-core/transaction-platform';
import { applyWalletEntry } from '../../modules/wallet-ledger/wallet-ledger';
import { Prisma } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('transacoes')
@UseGuards(JwtAuthGuard)
@ApiTags('Transações')
@ApiBearerAuth()
export class TransactionsController {
  constructor(
    private readonly list: ListTransactionsUseCase,
    private readonly detail: GetTransactionDetailsUseCase,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar transações' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: {
          transactions: [
            {
              id: 'uuid-trx-1',
              status: 'COMPLETED',
              paymentMethod: 'PIX',
              amount: '100.00',
              acquirer: 'DOM',
            },
          ],
          total: 1,
        },
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: {
        statusCode: 400,
        message: ['limit must not be greater than 100'],
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<{
    data: unknown;
    page: number;
    limit: number;
  }> {
    const out = await this.list.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? '',
      query,
    });
    return out;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes da transação' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        status: 'OK',
        order: {
          id_transaction: '8948074',
          total: 1,
          client_name: 'Breno Lima',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    schema: {
      example: { statusCode: 404, message: 'Transação não encontrada' },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async detailRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<any> {
    const out = await this.detail.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? '',
      id,
    });
    return out;
  }

  @Patch(':id/plataforma')
  @ApiOperation({
    summary:
      'Associar (ou remover) a plataforma de uma transação; somente administrador',
  })
  async setPlatform(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() body: { platformTag?: string | null },
  ): Promise<{ id: string; platformTag: string | null }> {
    if (user?.role !== 'ADMIN')
      throw new ForbiddenException('Exige administrador');
    const platformTag = canonicalTransactionPlatformTag(body?.platformTag);
    const target = platformTag
      ? await this.prisma.platform.findUnique({
          where: { tag: platformTag },
          select: { id: true, ownerUserId: true },
        })
      : null;
    if (platformTag && !target)
      throw new NotFoundException('Plataforma não encontrada');
    const found = await this.prisma.transaction.findUnique({
      where: { id },
      select: { id: true, userId: true, platformTag: true },
    });
    if (!found) throw new NotFoundException('Transação não encontrada');
    const previousTag = found.platformTag ?? null;
    if (previousTag === platformTag) return { id, platformTag };

    return this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.transaction.update({
          where: { id },
          data: { platformTag },
          select: { id: true, platformTag: true },
        });
        // O crédito da transação acompanha a plataforma: estorna de quem o
        // detém hoje no BalanceLog e lança no dono da nova plataforma (ou no
        // vendedor da transação quando a plataforma é removida).
        const logs = await tx.balanceLog.groupBy({
          by: ['userId'],
          where: { transactionId: id },
          _sum: { balanceDelta: true },
        });
        const held = new Map(
          logs.map((l) => [
            l.userId,
            new Prisma.Decimal(l._sum.balanceDelta ?? 0),
          ]),
        );
        const total = [...held.values()].reduce(
          (acc, v) => acc.plus(v),
          new Prisma.Decimal(0),
        );
        if (total.isZero()) return updated;
        const targetUserId = target?.ownerUserId ?? found.userId;
        const holders = new Set([...held.keys(), targetUserId]);
        for (const userId of holders) {
          const desired =
            userId === targetUserId ? total : new Prisma.Decimal(0);
          const delta = desired.minus(held.get(userId) ?? 0);
          if (delta.isZero()) continue;
          await applyWalletEntry(tx, {
            userId,
            action: delta.isNegative()
              ? 'PLATFORM_REASSIGN_REVERSAL'
              : 'PLATFORM_REASSIGN_CREDIT',
            source: 'ADMIN_PLATFORM_REASSIGN',
            transactionId: id,
            balanceDelta: delta,
            description: `Plataforma alterada: ${previousTag ?? 'nenhuma'} → ${platformTag ?? 'nenhuma'}`,
            metadata: {
              fromPlatformTag: previousTag,
              toPlatformTag: platformTag,
            },
          });
        }
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
