import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthResponseDto } from '../../dtos/auth/auth-response.dto';
import { LoginDto } from '../../dtos/auth/login.dto';
import { SESSION_REPOSITORY } from '../../../core/repositories/session.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import { AuthTokensService } from './auth-tokens.service';

import type { ISessionRepository } from '../../../core/repositories/session.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IHashService } from '../../../core/services/hash.interface';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: ISessionRepository,
    @Inject(HASH_SERVICE) private readonly hash: IHashService,
    private readonly tokens: AuthTokensService,
  ) {}

  async execute(input: {
    dto: LoginDto;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<AuthResponseDto> {
    const { email, password } = input.dto;

    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const ok = await this.hash.compare(password, user.password);
    if (!ok) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const { token: accessToken, expiresIn } = await this.tokens.signAccessToken(
      {
        sub: user.id,
        email: user.email,
        role: user.role as any,
      } as any,
    );

    const refreshToken = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.sessions.create({
      userId: user.id,
      refreshToken,
      userAgent: input.userAgent ?? undefined,
      ipAddress: input.ipAddress ?? undefined,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
