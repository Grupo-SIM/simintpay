import { OwnedPlatformReportsService } from '../application/services/owned-platform-reports.service';
import {
  OwnedPlatformReportsController,
  PlatformReportBalancesController,
} from './controllers/owned-platform-reports.controller';
import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { ReportController } from './controllers/report.controller';
import { DashboardSummaryUseCase } from '../application/use-cases/report/dashboard-summary.use-case';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [
    ReportController,
    OwnedPlatformReportsController,
    PlatformReportBalancesController,
  ],
  providers: [
    OwnedPlatformReportsService,
    DashboardSummaryUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class ReportModule {}
