import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PlatformOverviewReports } from '../../platform-core/platform-overview-reports';

/** Legacy report contracts share the core; old permissions remain at HTTP aliases. */
@Injectable()
export class PlatformDashboardService extends PlatformOverviewReports {
  constructor(prisma: PrismaService) { super(prisma); }
}
