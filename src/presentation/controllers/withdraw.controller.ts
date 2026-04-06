import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListWithdrawalsQueryDto } from '../../application/dtos/withdraw/list-withdrawals.query.dto';
import { RequestWithdrawDto } from '../../application/dtos/withdraw/request-withdraw.dto';
import { ListWithdrawalsUseCase } from '../../application/use-cases/withdraw/list-withdrawals.use-case';
import { RequestWithdrawUseCase } from '../../application/use-cases/withdraw/request-withdraw.use-case';
import { CheckPendingWithdrawUseCase } from '../../application/use-cases/withdraw/check-pending-withdraw.use-case';
import { GetWithdrawSummaryUseCase } from '../../application/use-cases/withdraw/get-withdraw-summary.use-case';
import { GetWithdrawReceiptUseCase } from '../../application/use-cases/withdraw/get-withdraw-receipt.use-case';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('saques')
@UseGuards(JwtAuthGuard)
@ApiTags('Saques')
@ApiBearerAuth()
export class WithdrawController {
  constructor(
    private readonly requestWithdraw: RequestWithdrawUseCase,
    private readonly listWithdrawals: ListWithdrawalsUseCase,
    private readonly checkPending: CheckPendingWithdrawUseCase,
    private readonly getSummary: GetWithdrawSummaryUseCase,
    private readonly getWithdrawReceipt: GetWithdrawReceiptUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar saques' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [{ requestId: 'uuid-wd-1', fee: 1.5, netAmount: 98.5, totalAmount: 100 }],
        page: 1,
        pageSize: 10,
        total: 1,
      },
    },
  })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async list(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListWithdrawalsQueryDto,
  ): Promise<{ data: unknown; page: number; pageSize: number; total: number }> {
    return this.listWithdrawals.execute({ userId: user?.sub ?? '', query });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Solicitar saque' })
  @ApiBody({
    type: RequestWithdrawDto,
    examples: {
      default: { value: { valor: 150, chavePix: '123.456.789-00' } },
    },
  })
  @ApiResponse({
    status: 201,
    schema: { example: { data: { requestId: 'uuid-wd-1' }, message: 'Saque solicitado com sucesso' } },
  })
  @ApiResponse({
    status: 400,
    schema: { example: { statusCode: 400, message: ['O valor mínimo para saque é de R$ 100,00'] } },
  })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async create(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: RequestWithdrawDto,
  ): Promise<unknown> {
    return this.requestWithdraw.execute(user?.sub ?? '', dto);
  }

  @Get('verificar-pendente')
  @ApiOperation({ summary: 'Verificar se existe saque pendente' })
  @ApiResponse({ status: 200, schema: { example: { data: { hasPending: false } } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async verificarPendente(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    const out = await this.checkPending.execute(user?.sub ?? '');
    return { data: out };
  }

  @Get('resumo')
  @ApiOperation({ summary: 'Obter resumo financeiro para saque' })
  @ApiResponse({ status: 200, schema: { example: { data: { availableBalance: 100, netBalance: 91 } } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async summary(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    const out = await this.getSummary.execute(user?.sub ?? '');
    return { data: out };
  }

  @Get(':id/comprovante')
  @ApiOperation({
    summary: 'Baixar ou visualizar comprovante do saque',
    description:
      'Retorna o arquivo (imagem/PDF). Autenticado: dono do saque ou ADMIN. Usa credenciais Storj no servidor se o bucket não for público.',
  })
  @ApiResponse({ status: 200, description: 'Stream do arquivo' })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 403, schema: { example: { statusCode: 403, message: 'Forbidden' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Not Found' } } })
  async comprovante(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<StreamableFile> {
    const out = await this.getWithdrawReceipt.execute({
      withdrawId: id,
      requesterId: user?.sub ?? '',
      requesterRole: user?.role ?? 'USER',
    });
    return new StreamableFile(out.buffer, {
      type: out.contentType,
      disposition: 'inline; filename="comprovante"',
    });
  }
}
