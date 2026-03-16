import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthResponseDto } from '../../dtos/auth/auth-response.dto';
import { RegisterDto } from '../../dtos/auth/register.dto';
import { SESSION_REPOSITORY } from '../../../core/repositories/session.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { AuthTokensService } from './auth-tokens.service';

import type { ISessionRepository } from '../../../core/repositories/session.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: ISessionRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(HASH_SERVICE) private readonly hash: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly tokens: AuthTokensService,
  ) {}

  async execute(input: {
    dto: RegisterDto;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<AuthResponseDto> {
    const { name, email, password } = input.dto;

    const exists = await this.users.findByEmail(email);
    if (exists) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashed = await this.hash.hash(password);

    const domReg = await this.gateway.register({ name, email, password });
    const domTok = await this.gateway.generateToken(email, password);

    const user = await this.users.create({
      name,
      email,
      password: hashed,
      domUserId: domReg.domUserId,
      domToken: domTok.domToken,
    });

    await this.wallets.createForUser(user.id);

    const { token: accessToken, expiresIn } = await this.tokens.signAccessToken(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
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
