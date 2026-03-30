import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RenovadaDashboardService } from '../services/renovada-dashboard.service';

@ApiTags('Renovada Dashboard')
@Controller('dashboard/renovada')
export class RenovadaDashboardController {
  constructor(private readonly dashboardService: RenovadaDashboardService) { }

  @Get('stats')
  @ApiOperation({ summary: '[RENOVADA] Obter dados da dashboard' })
  async getStats(@Query('period') period?: string, @Query('dataInicio') dataInicio?: string, @Query('dataFim') dataFim?: string) {
    return this.dashboardService.getDashboardData(period, dataInicio, dataFim);
  }
}
