import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1) Tenta JWT padrão (Bearer token)
    try {
      const result = await (super.canActivate(context) as Promise<boolean>);
      if (result) return true;
    } catch {
      // JWT falhou — continua para fallback
    }

    // 2) Fallback: x-access-token (domToken) para integrações de plataforma (ex: pagatg)
    const domToken = request.headers['x-access-token'] as string | undefined;
    if (domToken && domToken.length >= 8) {
      let user = await this.prisma.user.findFirst({
        where: { domToken, isActive: true },
        select: { id: true, email: true, role: true },
      });

      if (!user) {
        const created = await this.prisma.user.create({
          data: {
            name: 'Platform User',
            email: `platform-${domToken.substring(0, 8)}@auto.simpay.com`,
            password: 'EXTERNAL_TOKEN_AUTH',
            domToken,
            role: 'USER',
          },
          select: { id: true, email: true, role: true },
        });
        user = created;
      }

      request.user = { sub: user.id, email: user.email, role: user.role };
      return true;
    }

    throw new UnauthorizedException();
  }

  override handleRequest(err: any, user: any) {
    if (user) return user;
    if (err) throw err;
    throw new UnauthorizedException();
  }
}
