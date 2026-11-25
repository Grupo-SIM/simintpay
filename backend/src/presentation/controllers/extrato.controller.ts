import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ListExtratoQueryDto } from '../../application/dtos/extrato/list-extrato.query.dto';
import { ListExtratoUseCase } from '../../application/use-cases/extrato/list-extrato.use-case';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';

@Controller('extrato')
@UseGuards(JwtAuthGuard)
@ApiTags('Extrato')
@ApiBearerAuth()
export class ExtratoController {
  constructor(private readonly listExtrato: ListExtratoUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Listar alterações de saldo do usuário autenticado',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [
          {
            id: 'uuid-log-1',
            action: 'LINK_SETTLEMENT_COMPLETED',
            natureza: 'SALE',
            descricao: 'Venda',
            transacaoId: 'uuid-tx-1',
            valor: 90,
            valorBloqueado: 0,
            criadoEm: '2026-11-24T12:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        resumo: { entradas: 90, saidas: 0 },
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  list(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListExtratoQueryDto,
  ) {
    return this.listExtrato.execute({ userId: user?.sub ?? '', query });
  }
}
