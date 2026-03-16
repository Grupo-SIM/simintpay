import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { DashboardSummaryUseCase } from '../../application/use-cases/report/dashboard-summary.use-case';
import { MonthlyRevenueUseCase } from '../../application/use-cases/report/monthly-revenue.use-case';
export declare class ReportController {
    private readonly dashboard;
    private readonly monthly;
    constructor(dashboard: DashboardSummaryUseCase, monthly: MonthlyRevenueUseCase);
    dashboardRoute(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
    monthlyRoute(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
}
