import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
export declare class DashboardSummaryUseCase {
    private readonly prisma;
    constructor(prisma: PrismaService);
    execute(input: {
        userId: string;
    }): Promise<{
        data: unknown;
    }>;
}
