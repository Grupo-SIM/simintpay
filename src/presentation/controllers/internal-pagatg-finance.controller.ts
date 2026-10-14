import { LegacyInternalAuthGuard } from '../../modules/platform-core/legacy-internal-auth.guard';
import { SetMetadata, UseGuards } from '@nestjs/common';
import { InternalPagatgFinanceService } from '../../modules/unified-platform/finance/legacy-pagatg-finance.service';
import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { CreateVoucherDto, UpdateVoucherDto, ValidateVoucherDto } from '../../application/dtos/voucher/voucher.dto';

@Controller('internal/pagatg/finance')
@SetMetadata('legacy-platform-tag', 'PAGATG')
@UseGuards(LegacyInternalAuthGuard)
export class InternalPagatgFinanceController {
  constructor(private readonly finance: InternalPagatgFinanceService) {}

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
    @Body() body: { cpf: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.requestWithdraw(body, internalToken); }

  /**
   * Cria ou atualiza um plano no api-machine espelhando o plano criado no api-pagatg.
   * Chamado automaticamente pelo api-pagatg após criar o plano no DOM.
   * O campo `code` recebe o código gerado pelo api-pagatg (ex: "3f8f67274"),
   * permitindo que o checkout encontre o plano via GET /planos/public/by-code/:code.
   */
  @Post('plans')
  async upsertPlan(
    @Body() body: {
      cpf: string;
      userId?: string;
      code: string;
      name: string;
      price: number;
      type: 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
      domPlanId: string;
      redirectUrl?: string | null;
      webhookUrl?: string | null;
      paymentMethods?: string | null;
      isActive?: boolean;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.upsertPlan(body, internalToken); }

  /**
   * Registra uma transação de assinatura pagatg no simpay.
   * Chamado pelo api-pagatg quando recebe SIGNATURE-CREATED ou SIGNATURE-INVOICE-PAID.
   * O netAmount é calculado pela taxa LIQUIDEZ do tenant PAGATG se não for fornecido.
   */
  @Post('record-transaction')
  async recordTransaction(
    @Body() body: {
      cpf: string;
      userId?: string;
      domPaymentId: string;
      domSubscriptionId?: string;
      amount: number;
      netAmount?: number;
      planDescription: string;
      customerName?: string;
      customerEmail?: string;
      customerDocument?: string;
      paymentMethod?: string;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.recordTransaction(body, internalToken); }

  @Get('vouchers')
  async listVouchers(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.listVouchers(cpf, userId, internalToken); }

  @Post('vouchers')
  async createVoucher(
    @Body() body: { cpf: string; userId?: string; dto: CreateVoucherDto },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.createVoucher(body, internalToken); }

  @Post('vouchers/validate')
  async validateVoucher(
    @Body() body: { cpf: string; userId?: string; dto: ValidateVoucherDto },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.validateVoucher(body, internalToken); }

  @Post('vouchers/update/:id')
  async updateVoucher(
    @Param('id') id: string,
    @Body() body: { cpf: string; userId?: string; dto: UpdateVoucherDto },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.updateVoucher(id, body, internalToken); }

  @Post('vouchers/delete/:id')
  async deleteVoucher(
    @Param('id') id: string,
    @Body() body: { cpf: string; userId?: string },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.deleteVoucher(id, body, internalToken); }

}
