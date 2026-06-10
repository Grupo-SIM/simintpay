import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './controllers/auth.controller';
import { HealthController } from './controllers/health.controller';
import { LoginUseCase } from '../application/use-cases/auth/login.use-case';
import { RegisterUseCase } from '../application/use-cases/auth/register.use-case';
import { LinkExternalPlatformUserService } from '../application/services/link-external-platform-user.service';
import { RefreshTokenUseCase } from '../application/use-cases/auth/refresh-token.use-case';
import { LogoutUseCase } from '../application/use-cases/auth/logout.use-case';
import { GetMeUseCase } from '../application/use-cases/auth/get-me.use-case';
import { ForgotPasswordUseCase } from '../application/use-cases/auth/forgot-password.use-case';
import { ResetPasswordUseCase } from '../application/use-cases/auth/reset-password.use-case';
import { EmailService } from '../infrastructure/email/email.service';
import { AuthTokensService } from '../application/use-cases/auth/auth-tokens.service';
import { JwtStrategy } from '../infrastructure/security/strategies/jwt.strategy';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { HASH_SERVICE } from '../core/services/hash.interface';
import { BcryptService } from '../infrastructure/security/bcrypt.service';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';
import { SESSION_REPOSITORY } from '../core/repositories/session.repository.interface';
import { PrismaSessionRepository } from '../infrastructure/database/repositories/prisma-session.repository';
import { WALLET_REPOSITORY } from '../core/repositories/wallet.repository.interface';
import { PrismaWalletRepository } from '../infrastructure/database/repositories/prisma-wallet.repository';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET!,
    }),
    ApiDomModule,
    ConfigModule.forRoot(),
  ],
  controllers: [AuthController, HealthController],
  providers: [
    JwtStrategy,
    AuthTokensService,
    LoginUseCase,
    RegisterUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    GetMeUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    EmailService,
    { provide: HASH_SERVICE, useClass: BcryptService },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository },
    LinkExternalPlatformUserService,
  ],
  exports: [USER_REPOSITORY, WALLET_REPOSITORY],
})
export class AuthModule { }
