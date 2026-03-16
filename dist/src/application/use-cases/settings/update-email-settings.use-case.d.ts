import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { UpdateEmailSettingsDto } from '../../dtos/settings/update-email-settings.dto';
export declare class UpdateEmailSettingsUseCase {
    private readonly prisma;
    constructor(prisma: PrismaService);
    execute(input: {
        userId: string;
        dto: UpdateEmailSettingsDto;
    }): Promise<{
        data: unknown;
    }>;
}
