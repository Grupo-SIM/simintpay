import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
export declare class GetEmailSettingsUseCase {
    private readonly prisma;
    constructor(prisma: PrismaService);
    execute(input: {
        userId: string;
    }): Promise<{
        data: unknown;
    }>;
}
