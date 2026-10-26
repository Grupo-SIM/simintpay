import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../../infrastructure/security/strategies/jwt.strategy';
import { PlatformCustomerReports } from '../../platform-core/platform-customer-reports';

/** Preserved personal CPF/pool selector. Product queries use the same reporting core. */
@Injectable()
export class ClienteDashboardService {
  constructor(private readonly prisma: PrismaService) {}
  getDashboardData(period = 'hoje', user: JwtPayload) {
    return new PlatformCustomerReports(this.prisma).getDashboardData(period, user);
  }
}
