import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthResponseDto } from '../../dtos/auth/auth-response.dto';
import { LoginDto } from '../../dtos/auth/login.dto';
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
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: ISessionRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(HASH_SERVICE) private readonly hash: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly tokens: AuthTokensService,
  ) {}

  async execute(input: {
    dto: LoginDto;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<AuthResponseDto> {
    const { email, password } = input.dto;

    let user = await this.users.findByEmail(email);

    if (user) {
      const ok = await this.hash.compare(password, user.password);
      if (!ok) {
        throw new UnauthorizedException('Credenciais inválidas');
      }
      
      // Se usuário não tem domToken, tentar obter do DOM
      if (!user.domToken) {
        try {
          const dom = await this.gateway.generateToken(email, password);
          await this.users.updateDomData(user.id, {
            domToken: dom.domToken,
            domUserId: dom.domUserId ?? null,
          });
          user.domToken = dom.domToken;
          user.domUserId = dom.domUserId ?? null;
        } catch (error) {
          // Se falhar, continua com o token existente
          console.warn('Failed to update domToken for existing user:', error.message);
        }
      }
    } else {
      const dom = await this.gateway.generateToken(email, password);

      const hashed = await this.hash.hash(password);
      user = await this.users.create({
        name: dom.name ?? email.split('@')[0] ?? 'Usuário',
        email,
        password: hashed,
        domUserId: dom.domUserId ?? null,
        domToken: dom.domToken,
      });

      const wallet = await this.wallets.findByUserId(user.id);
      if (!wallet) {
        await this.wallets.createForUser(user.id);
      }
    }

    const { token: accessToken, expiresIn } = await this.tokens.signAccessToken(
      {
        sub: user.id,
        email: user.email,
        role: user.role as any,
        domToken: user.domToken, // Adicionar domToken ao JWT
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
