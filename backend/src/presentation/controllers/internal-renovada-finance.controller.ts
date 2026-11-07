import { LegacyInternalAuthGuard } from '../../modules/platform-core/legacy-internal-auth.guard';
import { SetMetadata, UseGuards } from '@nestjs/common';
import { InternalRenovadaFinanceService } from '../../modules/unified-platform/finance/legacy-renovada-finance.service';
import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import {
  resolveWithdrawalFixedFee,
  getPlatformTaxaEffective,
} from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

@Controller('internal/renovada/finance')
@SetMetadata('legacy-platform-tag', 'RENOVADA')
@UseGuards(LegacyInternalAuthGuard)
export class InternalRenovadaFinanceController {
  constructor(private readonly finance: InternalRenovadaFinanceService) {}

  @Get('fees')
  fees() {
    return {
      taxaFixa: resolveWithdrawalFixedFee('RENOVADA'),
      taxaPercent: getPlatformTaxaEffective(
        'RENOVADA',
        'TAXA_SAQUE_PERCENT',
        PLATFORM_TAXA_DEFAULTS.TAXA_SAQUE_PERCENT,
      ),
      saqueMin: getPlatformTaxaEffective(
        'RENOVADA',
        'SAQUE_MIN',
        PLATFORM_TAXA_DEFAULTS.SAQUE_MIN,
      ),
    };
  }

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    return this.finance.summary(cpf, userId, internalToken);
  }

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
  ) {
    return this.finance.transactions(
      cpf,
      userId,
      page,
      limit,
      startDate,
      endDate,
      status,
      description,
      internalToken,
    );
  }

  @Get('withdrawals')
  async withdrawals(
    @Query('cpf') cpf: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Headers('x-internal-token') internalToken?: string,
  ) {
    return this.finance.withdrawals(cpf, userId, page, limit, internalToken);
  }

  @Post('withdraw')
  async requestWithdraw(
    @Body()
    body: { cpf?: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    return this.finance.requestWithdraw(body, internalToken);
  }
}
