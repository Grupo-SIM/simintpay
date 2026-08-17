import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListTransactionsQueryDto } from '../../application/dtos/transactions/list-transactions.query.dto';
import { ListTransactionsUseCase } from '../../application/use-cases/transactions/list-transactions.use-case';
import { GetTransactionDetailsUseCase } from '../../application/use-cases/transactions/get-transaction-details.use-case';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('transacoes')
@UseGuards(JwtAuthGuard)
@ApiTags('Transações')
@ApiBearerAuth()
export class TransactionsController {
  constructor(
    private readonly list: ListTransactionsUseCase,
    private readonly detail: GetTransactionDetailsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar transações' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: { transactions: [{ id: 'uuid-trx-1', status: 'COMPLETED', paymentMethod: 'PIX', amount: '100.00', acquirer: 'DOM' }], total: 1 },
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['limit must not be greater than 100'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<{
    data: unknown;
    page: number;
    limit: number;
  }> {
    const out = await this.list.execute({ userId: user?.sub ?? '', role: user?.role ?? '', query });
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
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Transação não encontrada' } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async detailRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<any> {
    const out = await this.detail.execute({ userId: user?.sub ?? '', id });
    return out;
  }
}
