import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY } from '../../../core/repositories/session.repository.interface';

import type { ISessionRepository } from '../../../core/repositories/session.repository.interface';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: ISessionRepository,
  ) {}

  async execute(input: { refreshToken: string }): Promise<void> {
    await this.sessions.deleteByRefreshToken(input.refreshToken);
  }
}
