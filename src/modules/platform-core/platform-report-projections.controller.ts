import { PlatformSellerReports } from './platform-seller-reports';
import { BadRequestException, Controller, Get, Inject, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY, type IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { PlatformReportingService } from '../../application/services/platform-reporting.service';
import { PlatformAdministrationService } from './platform-administration.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';

@Controller('platforms/:tag/reports')
@UseGuards(PlatformAuthGuard)
export class PlatformReportProjectionsController {
  constructor(private readonly prisma: PrismaService, @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway, private readonly reporting: PlatformReportingService) {}

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
