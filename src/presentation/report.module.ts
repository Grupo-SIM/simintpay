import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { ReportController } from './controllers/report.controller';
import { DashboardSummaryUseCase } from '../application/use-cases/report/dashboard-summary.use-case';
import { MonthlyRevenueUseCase } from '../application/use-cases/report/monthly-revenue.use-case';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [ReportController],
  providers: [
    DashboardSummaryUseCase,
    MonthlyRevenueUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class ReportModule {}
