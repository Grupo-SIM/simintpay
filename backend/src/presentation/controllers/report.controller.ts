import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { DashboardSummaryUseCase } from '../../application/use-cases/report/dashboard-summary.use-case';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('relatorios')
@UseGuards(JwtAuthGuard)
@ApiTags('Relatórios')
@ApiBearerAuth()
export class ReportController {
  constructor(private readonly dashboard: DashboardSummaryUseCase) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Resumo do dashboard' })
  @ApiResponse({
    status: 200,
    schema: { example: { data: { total: 1000, count: 10 } } },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async dashboardRoute(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    return this.dashboard.execute({ userId: user?.sub ?? '' });
  }
}
