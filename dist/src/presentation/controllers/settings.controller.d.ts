import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { UpdateProfileDto } from '../../application/dtos/settings/update-profile.dto';
import { UpdateEmailSettingsDto } from '../../application/dtos/settings/update-email-settings.dto';
import { GetProfileUseCase } from '../../application/use-cases/settings/get-profile.use-case';
import { UpdateProfileUseCase } from '../../application/use-cases/settings/update-profile.use-case';
import { GetEmailSettingsUseCase } from '../../application/use-cases/settings/get-email-settings.use-case';
import { UpdateEmailSettingsUseCase } from '../../application/use-cases/settings/update-email-settings.use-case';
import { GetTaxesUseCase } from '../../application/use-cases/settings/get-taxes.use-case';
export declare class SettingsController {
    private readonly getProfile;
    private readonly updateProfile;
    private readonly getEmail;
    private readonly updateEmail;
    private readonly taxes;
    constructor(getProfile: GetProfileUseCase, updateProfile: UpdateProfileUseCase, getEmail: GetEmailSettingsUseCase, updateEmail: UpdateEmailSettingsUseCase, taxes: GetTaxesUseCase);
    profileRoute(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
    updateProfileRoute(user: JwtPayload | undefined, dto: UpdateProfileDto): Promise<{
        data: unknown;
    }>;
    taxesRoute(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
    emailRoute(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
    updateEmailRoute(user: JwtPayload | undefined, dto: UpdateEmailSettingsDto): Promise<{
        data: unknown;
    }>;
}
