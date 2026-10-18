import { PlatformOverviewReports } from './platform-overview-reports';
import { PlatformSellerReports } from './platform-seller-reports';
import { unsupportedCapability } from './platform-adapters';
import { BadRequestException, Controller, Get, Inject, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY, type IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { PlatformReportingService } from '../../application/services/platform-reporting.service';
import { PlatformAdministrationService } from './platform-administration.service';
import { PlatformCustomerReports } from './platform-customer-reports';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';

@Controller('platforms/:tag/reports')
@UseGuards(PlatformAuthGuard)
export class PlatformReportProjectionsController {
  constructor(private readonly prisma: PrismaService, @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway, private readonly reporting: PlatformReportingService) {}

  @Get('customer') @SetMetadata('platform-operation', 'reports:read')
  async customer(@Req() request: { platformContext: PlatformContext }, @Query('period') period = 'hoje') {
    if (!['hoje', 'ontem', '7dias', '15dias', '30dias'].includes(period)) throw new BadRequestException('Período inválido');
    const result = await new PlatformCustomerReports(this.prisma, request.platformContext).getDashboardData(period, { sub: request.platformContext.ownerUserId });
    const cents = (value: number) => {
      const amount = new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();
      if (!Number.isSafeInteger(amount)) throw new BadRequestException('Valor fora do limite');
      return amount;
    };
    const money = (value: any): any => typeof value === 'number' ? cents(value) : Array.isArray(value) ? value.map(money) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, money(item)])) : value;
    return { unit: 'cents', scope: 'product-history', period: result.period,
      summary: { ownerWalletAvailableBalanceCents: cents(result.summary.availableBalance), balanceInProcessingCents: cents(result.summary.balanceInProcessing) },
      selected: { profit: money(result.selected.profit), withdrawals: result.selected.withdrawals },
      profit: money(result.profit), refunds: { count: result.estornos.quantidade, netAmountCents: cents(result.estornos.valorLiquido) }, withdrawals: result.withdrawals };
  }

  private administration(context: PlatformContext) { return new PlatformAdministrationService(this.prisma, this.gateway, this.reporting, context); }

  private serialize(value: any): any {
    if (Array.isArray(value)) return value.map(item => this.serialize(item));
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const monetary = new Set(['amount', 'receita', 'lucro', 'valor', 'valorBruto', 'valorLiquido', 'lucroAdmin', 'taxaDom', 'taxaSimIntPay', 'taxaFixa', 'taxaCashback', 'taxaServico', 'lucroPrejuizo', 'total', 'dom', 'plataforma', 'availableBalance', 'balanceInProcessing', 'maquinetas', 'offers', 'lucroSimpay', 'value', 'taxaCobrada', 'totalFee', 'taxaTotalDOM', 'taxaTotal']);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key.endsWith('Pct') && typeof item === 'number') return [key.replace(/Pct$/, 'Rate'), new Prisma.Decimal(item).div(100).toNumber()];
      if (key === 'percentual' && typeof item === 'number') return ['rate', new Prisma.Decimal(item).div(100).toNumber()];
      if (monetary.has(key) && (typeof item === 'number' || key === 'amount' && typeof item === 'string')) {
        const cents = new Prisma.Decimal(item as number).mul(100).toDecimalPlaces(0).toNumber();
        if (!Number.isSafeInteger(cents)) throw new BadRequestException('Valor fora do limite');
        return [`${key}Cents`, cents];
      }
      return [key, this.serialize(item)];
    }));
  }

  @Get('overview') @SetMetadata('platform-operation', 'reports:read')
  async overview(@Req() request: { platformContext: PlatformContext }, @Query('period') period = 'hoje') {
    if (!['hoje', 'ontem', '7dias', '15dias', '30dias'].includes(period)) throw new BadRequestException('Período inválido');
    const result = await new PlatformOverviewReports(this.prisma, request.platformContext).getDashboardData(request.platformContext.tag, period);
    return { unit: 'cents', data: this.serialize(result) };
  }

  @Get('withdrawal-fees') @SetMetadata('platform-operation', 'reports:read')
  async withdrawalFees(@Req() request: { platformContext: PlatformContext }) {
    const result = await new PlatformOverviewReports(this.prisma, request.platformContext).getSaquesDetalhados(request.platformContext.tag);
    return { unit: 'cents', ...this.serialize(result) };
  }

  @Get('payment-methods') @SetMetadata('platform-operation', 'reports:read')
  async paymentMethods(@Req() request: { platformContext: PlatformContext }) {
    const result = await this.administration(request.platformContext).getPlataformaDistribuicaoMetodo(request.platformContext.tag);
    return { unit: 'cents', total: result.total, items: this.serialize(result.items) };
  }

  @Get('atlas-products') @SetMetadata('platform-operation', 'reports:read')
  async atlasProducts(@Req() request: { platformContext: PlatformContext }) {
    if (request.platformContext.tag !== 'ATLAS') unsupportedCapability('reports.atlas-products');
    return { unit: 'cents', data: this.serialize(await this.administration(request.platformContext).getAtlasBreakdown()) };
  }

  @Get('communities') @SetMetadata('platform-operation', 'reports:read')
  async communities(@Req() request: { platformContext: PlatformContext }) {
    await this.administration(request.platformContext).getPlatformTransactionScope(request.platformContext.tag);
    return { unit: 'cents', ...this.serialize(await this.administration(request.platformContext).listPlataformaComunidades(request.platformContext.tag)) };
  }

  @Get('transactions') @SetMetadata('platform-operation', 'reports:read')
  async transactionDetails(@Req() request: { platformContext: PlatformContext }, @Query('page') page = '1', @Query('limit') limit = '20') {
    if (![page, limit].every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) || Number(limit) > 100) throw new BadRequestException('Paginação inválida');
    const result = await this.administration(request.platformContext).listPlataformaTransacoes(request.platformContext.tag, page, limit);
    return { unit: 'cents', ...result, data: this.serialize(result.data) };
  }

  @Get('sellers/stats') @SetMetadata('platform-operation', 'reports:read')
  sellerStats(@Req() request: { platformContext: PlatformContext }) {
    return new PlatformSellerReports(this.prisma, this.reporting, request.platformContext).getSellerStats(request.platformContext.tag);
  }

  @Get('sellers') @SetMetadata('platform-operation', 'reports:read')
  async sellers(@Req() request: { platformContext: PlatformContext }, @Query('page') page = '1', @Query('limit') limit = '20', @Query('activeOnly') activeOnly = 'true') {
    const result = await new PlatformSellerReports(this.prisma, this.reporting, request.platformContext).getActiveSellers(request.platformContext.tag, page, limit, activeOnly, 'carteiras');
    return { unit: 'cents', ...result, data: result.data.map(({ balance, lockedBalance, ...row }) => ({ ...row, balanceCents: new Prisma.Decimal(balance).mul(100).toDecimalPlaces(0).toNumber(), lockedBalanceCents: new Prisma.Decimal(lockedBalance).mul(100).toDecimalPlaces(0).toNumber() })) };
  }

  @Get('consolidated') @SetMetadata('platform-operation', 'reports:read')
  async consolidated(@Req() request: { platformContext: PlatformContext }, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('paymentMethod') paymentMethod?: string) {
    for (const value of [startDate, endDate]) {
      if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new BadRequestException('Data inválida');
    }
    if (startDate && endDate && endDate < startDate) throw new BadRequestException('Intervalo inválido');
    if (paymentMethod && !['PIX', 'CREDIT_CARD', 'DEBIT_CARD'].includes(paymentMethod)) throw new BadRequestException('paymentMethod inválido');
    const result = await new PlatformAdministrationService(this.prisma, this.gateway, this.reporting, request.platformContext)
      .getPlataformaConsolidado(request.platformContext.tag, startDate, endDate, paymentMethod, true);
    const data = Object.fromEntries(Object.entries(result).map(([key, value]) => {
      if (typeof value !== 'number' || ['qtdTransacoes', 'qtdMaquineta'].includes(key)) return [key, value];
      const cents = new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();
      if (!Number.isSafeInteger(cents)) throw new BadRequestException('Valor fora do limite');
      return [`${key}Cents`, cents];
    }));
    return { unit: 'cents', data };
  }
}
