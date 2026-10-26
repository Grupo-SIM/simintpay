import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SESSION_REPOSITORY } from '../../../core/repositories/session.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { AuthTokensService } from './auth-tokens.service';

import type { ISessionRepository } from '../../../core/repositories/session.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';

@Injectable()
export class RefreshTokenUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: ISessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly tokens: AuthTokensService,
  ) {}

  async execute(input: { refreshToken: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const session = await this.sessions.findByRefreshToken(input.refreshToken);
    if (!session) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.sessions.deleteById(session.id);
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = await this.users.findById(session.userId);
    if (!user) {
      await this.sessions.deleteById(session.id);
      throw new UnauthorizedException('Sessão inválida');
    }

    await this.sessions.deleteById(session.id);

    const { token: accessToken, expiresIn } = await this.tokens.signAccessToken(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
    );

    const newRefreshToken = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.sessions.create({
      userId: user.id,
      refreshToken: newRefreshToken,
      expiresAt,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
    });

    return { accessToken, refreshToken: newRefreshToken, expiresIn };
  }
}
