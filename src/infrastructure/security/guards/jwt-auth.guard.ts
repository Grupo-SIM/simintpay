import { Injectable, ExecutionContext, UnauthorizedException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
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

    let authenticated = false;
    // 1) Tenta JWT padrão (Bearer token)
    try {
      const result = await (super.canActivate(context) as Promise<boolean>);
      if (result) {
        this.logger.log(`[Auth] JWT válido para ${request.url}`);
        authenticated = true;
      }
    } catch (jwtErr: any) {
      this.logger.warn(`[Auth] JWT inválido para ${request.url}: ${jwtErr?.message ?? 'erro desconhecido'}`);
    }

    if (authenticated) {
      await this.authorizeClient(request);
      return true;
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

  private async authorizeClient(request: { user: { sub: string; role: string }; url: string; method: string; body?: Record<string, unknown> }) {
    const path = request.url.split('?')[0];
    if (request.user.role === 'ADMIN') {
      if (path.startsWith('/notifications/push')) throw new ForbiddenException('Notificações exclusivas para clientes aprovados');
      return;
    }
    if (request.method === 'DELETE' && path === '/notifications/push/subscriptions') return;
    const selfService = request.method === 'GET' && ['/admin/plataformas/cliente/dashboard', '/admin/cobrancas/minhas', '/admin/plataformas/minhas-taxas'].includes(path);
    if (!selfService && (/^\/(admin|comunidades|communities|platforms|plataformas)(\/|$)/.test(path) ||
        /^\/payments\/(admin|plan-access\/decrement-all)(\/|$)/.test(path))) {
      throw new ForbiddenException('Área administrativa restrita');
    }
    if (!/^\/(planos|links-pagamento|links-assinatura|boletos|payments\/pix-plan|notifications\/push)(\/|$)/.test(path)) return;
    const account = await this.prisma.user.findUnique({ where: { id: request.user.sub }, select: { clientStatus: true } });
    if (account?.clientStatus !== 'APPROVED') throw new ForbiddenException('Conta precisa estar aprovada');
    if (request.method === 'GET' || request.method === 'DELETE') return;
    const body = request.body ?? {};
    const protectedFields = ['userId', 'ownerUserId', 'platformFee', 'platformFeeNx', 'platformTag', 'tenantTag', 'communityId', 'comunidadeId', 'code', 'codigo', 'taxa', 'taxas', 'domPlanId', 'domPaymentLinkId'];
    const administrativeFees = Object.keys(body).some(key => /^platformFee(?:\d+x|Nx)?$/.test(key) || ['cashbackFee', 'debitFeePercent', 'debitFeeFixed', 'customerInterestRates', 'absorbCustomerInterest'].includes(key));
    if (administrativeFees || protectedFields.some(key => body[key] !== undefined) || (Array.isArray(body.plataformas) && body.plataformas.length > 0)) {
      throw new ForbiddenException('Proprietário, taxas, código e vínculos administrativos não podem ser alterados');
    }
    for (const key of ['preco', 'valor', 'price']) {
      if (body[key] !== undefined && (!Number.isFinite(body[key]) || Number(body[key]) < 14.99)) {
        throw new BadRequestException('Valor mínimo é R$ 14,99');
      }
    }
  }

  override handleRequest(err: any, user: any) {
    if (user) return user;
    if (err) throw err;
    throw new UnauthorizedException();
  }
}
