import { PlatformSellerReports } from '../../platform-core/platform-seller-reports';
import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PlatformDashboardService } from '../services/renovada-dashboard.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PlatformReportingService } from '../../../application/services/platform-reporting.service';

@ApiTags('Admin Platforms')
@Controller('admin/plataformas')
export class PlatformDashboardController {
  constructor(
    private readonly dashboardService: PlatformDashboardService,
    private readonly prisma: PrismaService,
    private readonly platformReporting: PlatformReportingService,
  ) {}

  @Get(':tag/dashboard')
  @ApiOperation({ summary: 'Obter dados da dashboard de uma plataforma específica' })
  async getStats(
    @Param('tag') tag: string,
    @Query('period') period?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string
  ) {
    return this.dashboardService.getDashboardData(tag, period, dataInicio, dataFim);
  }

  @Get(':tag/saques')
  @ApiOperation({
    summary: 'Saques aprovados da plataforma no período, com a taxa cobrada em cada um',
  })
  async getSaques(
    @Param('tag') tag: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    return this.dashboardService.getSaquesDetalhados(tag, dataInicio, dataFim);
  }

  @Get(':tag/seller-stats')
  @ApiOperation({ summary: 'Sellers ativos e total de contas por plataforma' })
  async getSellerStats(@Param('tag') tag: string) { return new PlatformSellerReports(this.prisma, this.platformReporting).getSellerStats(tag); }

  @Get(':tag/sellers-ativos')
  @ApiOperation({ summary: 'Lista paginada de usuários/assinantes com saldo da carteira. apenasAtivos=false retorna todos.' })
  async getActiveSellers(
    @Param('tag') tag: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('apenasAtivos') apenasAtivos = 'true',
    @Query('fonteSaldo') fonteSaldo?: string,
  ) { return new PlatformSellerReports(this.prisma, this.platformReporting).getActiveSellers(tag, page, pageSize, apenasAtivos, fonteSaldo); }
}
