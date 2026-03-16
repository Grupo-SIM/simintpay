import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';

@Injectable()
export class AuthTokensService {
  constructor(private readonly jwt: JwtService) {}

  async signAccessToken(payload: {
    sub: string;
    email: string;
    role: Role;
  }): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = 15 * 60;
    const token = await this.jwt.signAsync(payload, { expiresIn });
    return { token, expiresIn };
  }
}
