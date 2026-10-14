import { InternalEbookFinanceService } from '../../modules/unified-platform/finance/legacy-ebook-finance.service';
import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';

@Controller('internal/ebook/finance')
export class InternalEbookFinanceController {
  constructor(private readonly finance: InternalEbookFinanceService) {}

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.summary(cpf, internalToken); }

  @Get('transactions')
  async transactions(
    @Query('cpf') cpf: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.transactions(cpf, page, limit, startDate, endDate, status, description, internalToken); }

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.withdrawals(cpf, page, limit, internalToken); }

  @Post('pending-transaction')
  async createPendingTransaction(
    @Body() body: {
      orderNumber: string;
      amount: number;
      ownerCpf?: string;
      ownerName?: string;
      paymentMethod?: string;
      buyerName?: string;
      buyerEmail?: string;
      buyerDocument?: string;
      installments?: number;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.createPendingTransaction(body, internalToken); }

  @Get('config')
  getConfig(@Headers('x-internal-token') internalToken?: string) { return this.finance.getConfig(internalToken); }

  @Post('credit-commission')
  async creditCommission(
    @Body() body: {
      referenceId: string; // ex: `AFF-<orderId>-<bookId>` — usado para idempotência
      cpf?: string;
      cnpj?: string;
      amount: number;
      description?: string;
    },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.creditCommission(body, internalToken); }

  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.requestWithdraw(body, internalToken); }

}
