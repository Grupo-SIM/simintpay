import { Module } from '@nestjs/common';
import { ClienteDashboardController } from './cliente-dashboard.controller';
import { ClienteDashboardService } from './services/cliente-dashboard.service';

@Module({
  controllers: [ClienteDashboardController],
  providers: [ClienteDashboardService],
})
export class ClienteDashboardModule {}
