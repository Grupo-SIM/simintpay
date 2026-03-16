import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListTransactionsQueryDto } from '../../application/dtos/transactions/list-transactions.query.dto';
import { ListTransactionsUseCase } from '../../application/use-cases/transactions/list-transactions.use-case';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('transacoes')
@UseGuards(JwtAuthGuard)
@ApiTags('Transações')
@ApiBearerAuth()
export class TransactionsController {
  constructor(private readonly list: ListTransactionsUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Listar transações' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [{ id: 'uuid-trx-1', status: 'APROVADA', metodo: 'PIX', valor: 100 }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    },
  })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['pageSize must not be greater than 100'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<{
    data: unknown;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const out = await this.list.execute({ userId: user?.sub ?? '', query });
    return out;
  }
}
