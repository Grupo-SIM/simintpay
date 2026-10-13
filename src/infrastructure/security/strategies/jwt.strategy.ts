import { PrismaService } from '../../database/prisma/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  authMode?: "integration";
  platformId?: string;
  platformTag?: string;
  domToken?: string;
  domUserId?: string;
} & {
  domToken?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true, isPurged: true, role: true, email: true } });
    if (!user?.isActive || user.isPurged) throw new UnauthorizedException('Conta inativa');
    return { ...payload, role: user.role, email: user.email };
  }
}
