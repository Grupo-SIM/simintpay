import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Acquirer } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { canonicalPlatformTaxaTag } from '../platform-taxas/platform-taxas.store';
import { hashPlatformToken } from '../platform-integrations/platform-secrets';
import { DEFAULT_INBOUND_OPERATIONS } from '../platform-integrations/platform-integration-keys';

export interface PlatformContext {
  id: string;
  tag: string;
  ownerUserId: string;
  acquirer: Acquirer;
  delivery?: { credentialId: string; merchantId: string; externalCompanyId: string; profileId: string; allocate: boolean };
}

@Injectable()
export class PlatformContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tag: string): Promise<PlatformContext> {
    const platform = await this.prisma.platform.findUnique({
      where: { tag: canonicalPlatformTaxaTag(tag) }, include: { owner: true },
    });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (!platform.isActive || !platform.owner.isActive || platform.owner.isPurged) {
      throw new ForbiddenException('Plataforma ou dono inativo');
    }
    return { id: platform.id, tag: platform.tag, ownerUserId: platform.ownerUserId, acquirer: platform.acquirer };
  }

  async authorize(tag: string, operation: string, user?: JwtPayload, token?: string, externalMerchantId?: string): Promise<PlatformContext> {
    const platform = await this.resolve(tag);
    if (user && user.authMode !== 'integration') {
      const actor = await this.prisma.user.findUnique({ where: { id: user.sub } });
      if (!actor?.isActive || actor.isPurged) throw new UnauthorizedException('Conta inativa');
      if ((operation.startsWith('maintenance:') || operation === 'ledger:write') && actor.role !== 'ADMIN') throw new ForbiddenException('Exige administrador');
      if (actor.role !== 'ADMIN' && platform.ownerUserId !== actor.id) throw new ForbiddenException('Plataforma pertence a outro usuário');
      return platform;
    }
    if (!token || operation.startsWith('maintenance:')) throw new UnauthorizedException('Credencial obrigatória');
    const delegated = await this.prisma.platformApiCredential.findUnique({ where: { tokenHash: hashPlatformToken(token) }, include: { profile: true } });
    if (delegated) {
      if (!delegated.isActive || delegated.source !== 'delivery' || delegated.platformId !== platform.id || !externalMerchantId || delegated.externalCompanyId !== externalMerchantId || !delegated.profile.isActive || delegated.profile.acquirer !== platform.acquirer) throw new UnauthorizedException('Credencial inválida para comerciante');
      if (!delegated.operations.includes(operation)) throw new ForbiddenException('Credencial sem permissão para operação');
      const merchant = await this.prisma.integrationMerchant.findUnique({ where: { id: delegated.merchantId }, include: { user: true } });
      if (!merchant || merchant.externalMerchantId !== externalMerchantId || !merchant.user.isActive || merchant.user.isPurged) throw new UnauthorizedException('Comerciante inativo');
      return { ...platform, delivery: { credentialId: delegated.id, merchantId: merchant.id, externalCompanyId: externalMerchantId, profileId: delegated.profileId, allocate: delegated.operations.includes('payments:allocate') } };
    }
    const credential = await this.prisma.platformIntegration.findUnique({ where: { tokenHash: hashPlatformToken(token) } });
    if (credential?.key !== 'INBOUND_TOKEN' || credential.platformId !== platform.id) throw new UnauthorizedException('Credencial inválida para plataforma');
    const scopes = await this.prisma.platformIntegration.findUnique({ where: { platformId_key: { platformId: platform.id, key: 'INBOUND_OPERATIONS' } } });
    // Explicit scopes replace the defaults, including for existing credentials.
    const allowed: readonly string[] = scopes?.url?.split(',').map((value) => value.trim()) ?? DEFAULT_INBOUND_OPERATIONS;
    if (!allowed.includes(operation)) throw new ForbiddenException('Credencial sem permissão para operação');
    return platform;
  }
}
