import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ClienteDashboardService } from './services/cliente-dashboard.service';

@Controller('admin/plataformas/cliente')
export class ClienteDashboardController {
  constructor(private readonly dashboard: ClienteDashboardService) {}

  /** Dashboard do cliente SimintPay: saldo/lucro líquido por período. */
  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  async getDashboard(
    @CurrentUser() user: JwtPayload,
    @Query('period') period = 'hoje',
  ) {
    return this.dashboard.getDashboardData(period, user);
  }
}
