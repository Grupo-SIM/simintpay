import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PlatformDashboardReports } from '../../platform-core/platform-dashboard-reports';
import { platformDashboardRules } from '../../platform-core/platform-dashboard.adapter';

/** Legacy projection; query scope and financial calculations belong to shared core. */
@Injectable()
export class AtlasDashboardService extends PlatformDashboardReports {
  constructor(prisma: PrismaService) { super(prisma, platformDashboardRules('ATLAS')); }
}
