import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    this.logger.log(`[Auth] ${request.method} ${request.url} — verificando token`);

    // 1) Tenta JWT padrão (Bearer token)
    try {
      const result = await (super.canActivate(context) as Promise<boolean>);
      if (result) {
        this.logger.log(`[Auth] JWT válido para ${request.url}`);
        return true;
      }
    } catch (jwtErr: any) {
      this.logger.warn(`[Auth] JWT inválido para ${request.url}: ${jwtErr?.message ?? 'erro desconhecido'}`);
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

      this.logger.log(`[Auth] domToken válido para ${request.url} user=${user.id}`);
      request.user = { sub: user.id, email: user.email, role: user.role };
      return true;
    }

    this.logger.warn(`[Auth] Acesso negado (401) para ${request.url} — sem token válido`);
    throw new UnauthorizedException();
  }

  override handleRequest(err: any, user: any) {
    if (user) return user;
    if (err) throw err;
    throw new UnauthorizedException();
  }
}
