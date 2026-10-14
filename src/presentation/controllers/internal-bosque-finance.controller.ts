import { LegacyInternalAuthGuard } from '../../modules/platform-core/legacy-internal-auth.guard';
import { SetMetadata, UseGuards } from '@nestjs/common';
import { InternalBosqueFinanceService } from '../../modules/unified-platform/finance/legacy-bosque-finance.service';
import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';

@Controller('internal/bosque/finance')
@SetMetadata('legacy-platform-tag', 'BOSQUE')
@UseGuards(LegacyInternalAuthGuard)
export class InternalBosqueFinanceController {
  constructor(private readonly finance: InternalBosqueFinanceService) {}

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.summary(cpf, userId, internalToken); }

  @Get('transactions')
  async transactions(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.transactions(cpf, userId, page, limit, startDate, endDate, status, description, internalToken); }

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.withdrawals(cpf, userId, page, limit, internalToken); }

  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf?: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.requestWithdraw(body, internalToken); }

  /**
   * Zera o saldo DISPONÍVEL do Bosque AGORA (baseline), sem apagar histórico e sem
   * afetar vendas futuras. Cria um "saque" sintético (COMPLETED, pixKey=BASELINE_SALDO)
   * do valor disponível atual — o cálculo do disponível subtrai esse valor e passa a 0,
   * enquanto novas vendas continuam somando normalmente. O registro fica escondido do
   * histórico e é reversível (basta excluí-lo).
   *
   * Use quando o disponível mostra um resíduo de vendas antigas já pagas por fora
   * (sem solicitação de saque registrada).
   */
  @Post('zerar-disponivel')
  @ApiOperation({ summary: 'Zera (ou abate um valor de) o disponível do Bosque agora (baseline), mantendo vendas futuras' })
  async zerarDisponivel(
    @Body() body: { userId?: string; email?: string; cpf?: string; reason?: string; valor?: number } = {},
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.zerarDisponivel(body, internalToken); }

  /**
   * Inspeciona a carteira do Bosque (saldo bruto, travado e disponível).
   * Útil para conferir antes de corrigir.
   */
  @Get('wallet')
  async inspectWallet(
    @Query('userId') userId?: string,
    @Query('email') email?: string,
    @Query('cpf') cpf?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.inspectWallet(userId, email, cpf, internalToken); }

  /**
   * Corrige manualmente o saldo da carteira do Bosque (IBB).
   * - `balance`: define o saldo exato (ex.: 0 depois de sacar tudo).
   * - `delta`: alternativa — soma/subtrai do saldo atual.
   * - `lockedBalance` (opcional): corrige o valor travado preso por um saque.
   * Tudo fica registrado no BalanceLog (before/after) para auditoria.
   */
  @Post('fix-balance')
  @ApiOperation({ summary: 'Corrige manualmente o saldo da carteira do Bosque (IBB)' })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          example: 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c',
          description: 'ID da conta do Bosque. Se omitido, usa o BOSQUE_ID do ambiente.',
        },
        email: { type: 'string', example: 'contato@bosque.com.br' },
        balance: {
          type: 'number',
          example: 0,
          description: 'Define o saldo EXATO (R$). Use este campo para inserir o valor correto.',
        },
        delta: { type: 'number', description: 'Alternativa ao balance: soma (+) / subtrai (-) do saldo atual.' },
        lockedBalance: { type: 'number', description: 'Opcional: corrige o valor travado por saque pendente.' },
        reason: { type: 'string', example: 'Correção manual após troca de API' },
      },
    },
  })
  async fixBalance(
    @Body() body: {
      userId?: string;
      email?: string;
      cpf?: string;
      balance?: number;
      delta?: number;
      lockedBalance?: number;
      reason?: string;
    } = {},
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.fixBalance(body, internalToken); }

  /**
   * SOMENTE LEITURA. Recalcula qual deveria ser o saldo do Bosque a partir das
   * fontes canônicas — transações BOSQUE concluídas (crédito) e saques aprovados
   * (débito) — e mostra o resultado em base BRUTA e LÍQUIDA, comparado ao saldo
   * atual. Não altera nada: use o POST /fix-balance para aplicar o valor escolhido.
   *
   * Obs.: hoje o sync/webhook creditam o saldo pelo valor BRUTO (amount). Se o
   * correto for o líquido (amount × liquidez), o resíduo acumulado das taxas é o
   * que infla o saldo — compare `suggested.net` com o `current`.
   */
  @Get('reconcile')
  async reconcile(
    @Query('userId') userId?: string,
    @Query('email') email?: string,
    @Query('cpf') cpf?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.reconcile(userId, email, cpf, internalToken); }
}
