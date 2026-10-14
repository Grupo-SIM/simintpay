import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { encryptPlatformSecret, hashPlatformToken } from '../../modules/platform-integrations/platform-secrets';
import { initializePlatformIntegrationsCache, invalidatePlatformIntegrationsCache } from '../../modules/platform-integrations/platform-integrations.store';
import { PLATFORM_INTEGRATION_KEYS, PLATFORM_PUBLIC_VALUE_KEYS, PLATFORM_URL_KEYS } from '../../modules/platform-integrations/platform-integration-keys';

@Controller('platforms/:id/integrations')
@UseGuards(JwtAuthGuard)
export class PlatformIntegrationsController {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(id: string, user: JwtPayload | undefined) {
    if (!user || user.authMode === 'integration') throw new ForbiddenException('Exige sessão de usuário');
    const actor = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!actor?.isActive || actor.isPurged) throw new ForbiddenException('Conta inativa');
    const platform = await this.prisma.platform.findUnique({ where: { id } });
    if (!platform) throw new NotFoundException('Plataforma não encontrada');
    if (actor.role !== 'ADMIN' && platform.ownerUserId !== actor.id) throw new ForbiddenException('Acesso negado');
    return platform;
  }

  @Get()
  async list(@Param('id') id: string, @CurrentUser() user: JwtPayload | undefined) {
    await this.authorize(id, user);
    const rows = await this.prisma.platformIntegration.findMany({ where: { platformId: id } });
    return { data: rows.map(({ key, url, encryptedValue }) => ({ key, value: encryptedValue ? '********' : url, configured: !!(encryptedValue || url) })) };
  }

  @Put(':key')
  async put(@Param('id') id: string, @Param('key') key: string, @Body() body: { value?: unknown }, @CurrentUser() user: JwtPayload | undefined) {
    const platform = await this.authorize(id, user);
    if (['INBOUND_TOKEN', 'INBOUND_OPERATIONS', 'COMMUNITY_PLATFORM_TAG', 'LEGACY_MERCHANT_KEYS'].includes(key)) {
      const actor = await this.prisma.user.findUnique({ where: { id: user!.sub } });
      if (actor?.role !== 'ADMIN') throw new ForbiddenException('Associação exige administrador');
    }
    if (!(PLATFORM_INTEGRATION_KEYS as readonly string[]).includes(key)) throw new BadRequestException('Configuração desconhecida');
    if (body?.value === null) {
      await this.prisma.platformIntegration.deleteMany({ where: { platformId: id, key } });
    } else {
      if (typeof body?.value !== 'string' || !body.value.trim()) throw new BadRequestException('Valor obrigatório');
      const value = body.value.trim();
      if (PLATFORM_URL_KEYS.has(key)) {
        let url: URL;
        try { url = new URL(value); } catch { throw new BadRequestException('URL inválida'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new BadRequestException('URL HTTP(S) sem credenciais obrigatória');
      }
      if (['ENABLE_DOM_SYNC', 'DISABLE_SYNC'].includes(key) && !['true', 'false'].includes(value)) throw new BadRequestException('Use true ou false');
      if (key === 'INBOUND_OPERATIONS' && !value.split(',').every((scope) => ['payments:create', 'payments:read', 'finance:read', 'finance:withdraw', 'reports:read', 'events:read', 'sync:run', 'merchants:manage', 'mail:send', 'community:read'].includes(scope.trim()))) throw new BadRequestException('Operação inválida');
      if (key === 'COMMUNITY_PLATFORM_TAG') {
        if (platform.tag !== 'RETURN-BET') throw new BadRequestException('Referência exclusiva de Return Bet');
        const community = await this.prisma.platform.findUnique({ where: { tag: value } , include: { owner: true } });
        if (!community?.isActive || !community.owner.isActive || community.owner.isPurged) throw new BadRequestException('Comunidade não cadastrada ou inativa');
      }
      const data = {
        url: PLATFORM_PUBLIC_VALUE_KEYS.has(key) ? value : null,
        encryptedValue: PLATFORM_PUBLIC_VALUE_KEYS.has(key) ? null : encryptPlatformSecret(value),
        tokenHash: key === 'INBOUND_TOKEN' ? hashPlatformToken(value) : null,
      };
      try {
        await this.prisma.platformIntegration.upsert({ where: { platformId_key: { platformId: id, key } }, create: { platformId: id, key, ...data }, update: data });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw new BadRequestException('Token já associado a outra plataforma');
        throw error;
      }
    }
    invalidatePlatformIntegrationsCache();
    await initializePlatformIntegrationsCache(this.prisma);
    return this.list(id, user);
  }
}
