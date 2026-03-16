import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { SettingsController } from './controllers/settings.controller';
import { GetProfileUseCase } from '../application/use-cases/settings/get-profile.use-case';
import { UpdateProfileUseCase } from '../application/use-cases/settings/update-profile.use-case';
import { GetEmailSettingsUseCase } from '../application/use-cases/settings/get-email-settings.use-case';
import { UpdateEmailSettingsUseCase } from '../application/use-cases/settings/update-email-settings.use-case';
import { GetTaxesUseCase } from '../application/use-cases/settings/get-taxes.use-case';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [SettingsController],
  providers: [
    GetProfileUseCase,
    UpdateProfileUseCase,
    GetEmailSettingsUseCase,
    UpdateEmailSettingsUseCase,
    GetTaxesUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class SettingsModule {}
