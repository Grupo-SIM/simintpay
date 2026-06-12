import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { SettingsController } from './controllers/settings.controller';
import { GetProfileUseCase } from '../application/use-cases/settings/get-profile.use-case';
import { UpdateProfileUseCase } from '../application/use-cases/settings/update-profile.use-case';
import { GetEmailSettingsUseCase } from '../application/use-cases/settings/get-email-settings.use-case';
import { UpdateEmailSettingsUseCase } from '../application/use-cases/settings/update-email-settings.use-case';
import { GetTaxesUseCase } from '../application/use-cases/settings/get-taxes.use-case';
import { ChangePasswordUseCase } from '../application/use-cases/settings/change-password.use-case';
import { UpdateDocumentUseCase } from '../application/use-cases/settings/update-document.use-case';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';
import { HASH_SERVICE } from '../core/services/hash.interface';
import { BcryptService } from '../infrastructure/security/bcrypt.service';

@Module({
  imports: [ApiDomModule],
  controllers: [SettingsController],
  providers: [
    GetProfileUseCase,
    UpdateProfileUseCase,
    GetEmailSettingsUseCase,
    UpdateEmailSettingsUseCase,
    GetTaxesUseCase,
    ChangePasswordUseCase,
    UpdateDocumentUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: HASH_SERVICE, useClass: BcryptService },
  ],
})
export class SettingsModule {}
