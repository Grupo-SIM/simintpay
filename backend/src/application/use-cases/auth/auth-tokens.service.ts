import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';

@Injectable()
export class AuthTokensService {
  constructor(private readonly jwt: JwtService) {}

  async signAccessToken(
    payload: {
      sub: string;
      email: string;
      role: Role;
      impersonatedBy?: string;
    },
    options?: { expiresIn?: number },
  ): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = options?.expiresIn ?? 24 * 60 * 60; // 1 dia (segundos, padrão jsonwebtoken)
    const token = await this.jwt.signAsync(payload, { expiresIn });
    return { token, expiresIn };
  }
}
