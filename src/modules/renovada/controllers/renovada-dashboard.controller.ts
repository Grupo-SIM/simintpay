import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PlatformDashboardService } from '../services/renovada-dashboard.service';

@ApiTags('Admin Platforms')
@Controller('admin/plataformas')
export class PlatformDashboardController {
  constructor(private readonly dashboardService: PlatformDashboardService) { }

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
}
