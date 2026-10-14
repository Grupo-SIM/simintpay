import { UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export async function resolveLegacyMerchantPlatform(prisma: PrismaService, integrationKey: string) {
  if (integrationKey.startsWith('platform:')) {
    const platform = await prisma.platform.findUnique({ where: { id: integrationKey.slice('platform:'.length) }, include: { owner: true } });
    if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged) throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'merchants.binding' });
    return platform;
  }
  const candidates = await prisma.platformIntegration.findMany({ where: { key: 'LEGACY_MERCHANT_KEYS', platform: { isActive: true, owner: { isActive: true, isPurged: false } } }, include: { platform: true } });
  const matches = candidates.filter(row => row.url?.split(',').map(key => key.trim()).includes(integrationKey));
  if (matches.length !== 1) throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'merchants.binding', message: 'Integração exige associação explícita à plataforma' });
  return matches[0].platform;
}
