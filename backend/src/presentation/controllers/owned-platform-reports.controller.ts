import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { OwnedPlatformReportsService } from '../../application/services/owned-platform-reports.service';

type Filters = Parameters<OwnedPlatformReportsService['summary']>[1];

@Controller('relatorios')
@UseGuards(JwtAuthGuard)
export class OwnedPlatformReportsController {
  constructor(private readonly reports: OwnedPlatformReportsService) {}
  @Get('plataformas') catalog(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.catalog(user, query);
  }
  @Get('saldos-plataformas') balances(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.ownBalances(user, query);
  }
  @Get('saldos-carteira/resumo') walletTotals(@CurrentUser() user: JwtPayload) {
    return this.reports.walletBalanceTotals(user, false);
  }
  @Get('saldos-carteira') walletBalances(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.walletBalances(user, query, false);
  }
  @Get('financeiro') summary(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.summary(user, query);
  }
  @Get('financeiro/mensal') monthly(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.series(user, query, 'monthly');
  }
  @Get('financeiro/status') status(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.series(user, query, 'status');
  }
  @Get('financeiro/metodos') methods(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.series(user, query, 'method');
  }
  @Get('financeiro/transacoes') transactions(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.transactionDetails(user, query);
  }
  @Get('plataformas/:tag/produto') product(
    @CurrentUser() user: JwtPayload,
    @Param('tag') tag: string,
    @Query() query: Filters,
  ) {
    return this.reports.summary(user, { ...query, platform: tag });
  }
  @Get('plataformas/:tag/produto/transacoes') productTransactions(
    @CurrentUser() user: JwtPayload,
    @Param('tag') tag: string,
    @Query() query: Filters,
  ) {
    return this.reports.transactionDetails(user, { ...query, platform: tag });
  }
}

@Controller('admin/relatorios')
@UseGuards(JwtAuthGuard)
export class PlatformReportBalancesController {
  constructor(private readonly reports: OwnedPlatformReportsService) {}
  @Get('saldos-plataformas') balances(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.balances(user, query);
  }
  @Get('saldos-por-plataforma/:key') platformUsers(
    @CurrentUser() user: JwtPayload,
    @Param('key') key: string,
    @Query() query: Filters,
  ) {
    return this.reports.platformWalletBalances(user, query, key);
  }
  @Get('saldos-por-plataforma') platformBalances(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.platformWalletBalances(user, query);
  }
  @Get('saldos-carteiras/resumo') walletTotals(
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reports.walletBalanceTotals(user, true);
  }
  @Get('saldos-carteiras') walletBalances(
    @CurrentUser() user: JwtPayload,
    @Query() query: Filters,
  ) {
    return this.reports.walletBalances(user, query, true);
  }
}
