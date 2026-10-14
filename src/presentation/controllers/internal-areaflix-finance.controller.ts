import { InternalAreaflixFinanceService } from '../../modules/unified-platform/finance/legacy-areaflix-finance.service';
import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';

/**
 * Endpoints internos consumidos pelo saas-netflix-back (areaflix).
 * Espelha o padrão do internal-pagatg-finance: resolução de conta por CPF/CNPJ
 * e saques que entram na fila de aprovação do painel admin do simpay.
 */
@Controller('internal/areaflix/finance')
export class InternalAreaflixFinanceController {
  constructor(private readonly finance: InternalAreaflixFinanceService) {}

  /** Carteira simpay do admin (por CPF/CNPJ) — fonte única de saldo pós-vínculo. */
  @Get('wallet')
  async wallet(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.wallet(cpf, internalToken); }

  /** Verifica se existe conta simpay com o CPF/CNPJ informado (para liberar saques). */
  @Get('account')
  async accountStatus(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.accountStatus(cpf, internalToken); }

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.withdrawals(cpf, page, limit, internalToken); }

  /** Soma de saques ativos/concluídos (para o cálculo de saldo no lado areaflix). */
  @Get('withdrawals/totals')
  async withdrawalTotals(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.withdrawalTotals(cpf, internalToken); }

  /**
   * Transfere a titularidade de links criados pela conta de serviço da areaflix
   * para a conta simpay do admin (resolvida por CPF/CNPJ). A partir daí as vendas
   * creditam a carteira do próprio admin. Idempotente.
   */
  @Post('claim-links')
  async claimLinks(
    @Body()
    body: {
      cpf: string;
      paymentLinkIds?: string[];
      subscriptionLinkIds?: string[];
      /** Saldo líquido acumulado antes do vínculo — transferido da conta de serviço para o admin (uma única vez). */
      retroactiveAmount?: number;
      /** Email da conta de serviço da areaflix (dona original dos links/saldo). */
      serviceAccountEmail?: string;
      /** Nome do admin areaflix — exibido na tela de donos por CPF (Leads). */
      adminName?: string;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.claimLinks(body, internalToken); }

  /** Cria solicitação de saque — entra na fila do painel admin do simpay (platform: areaflix). */
  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.requestWithdraw(body, internalToken); }
}
