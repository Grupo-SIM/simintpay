import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { hashPlatformToken } from '../../../modules/platform-integrations/platform-secrets';
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
      // Integration credentials cannot act as an interactive user session.
      const path = String(request.url).split('?')[0];
      if (request.method !== 'POST' || !/^\/(links-pagamento|planos|links-assinatura|boletos|payments\/pix-plan)\/?$/.test(path)) {
        throw new UnauthorizedException('Token restrito a operações de integração');
      }
      const credential = await this.prisma.platformIntegration.findUnique({
        where: { tokenHash: hashPlatformToken(domToken) },
        include: { platform: { include: { owner: true } } },
      });
      const platform = credential?.key === 'INBOUND_TOKEN' ? credential.platform : null;
      if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged) {
        throw new UnauthorizedException('Token de plataforma não cadastrado ou inativo');
      }
      const selected = request.body?.plataformas;
      if (selected && (!Array.isArray(selected) || selected.some((tag: string) => String(tag).toUpperCase() !== platform.tag))) throw new UnauthorizedException('Token restrito à plataforma atribuída');
      if (request.body?.platformTag && String(request.body.platformTag).toUpperCase() !== platform.tag) throw new UnauthorizedException('Token restrito à plataforma atribuída');
      request.body ??= {};
      request.body.plataformas = [platform.tag];
      if (path === "/payments/pix-plan") {
        if (request.body.tenantTag && request.body.tenantTag.toUpperCase() !== platform.tag) throw new UnauthorizedException("Token restrito à plataforma atribuída");
        request.body.tenantTag = platform.tag;
      }
      request.user = {
        sub: platform.ownerUserId, email: platform.owner.email, role: 'USER',
        authMode: 'integration', platformId: platform.id, platformTag: platform.tag,
      };
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
