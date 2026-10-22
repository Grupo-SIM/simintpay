import { resolveLegacyMerchantPlatform } from '../integrations/legacy-merchant-platform';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { PlatformContext } from './platform-context.service';

/** Canonical namespace first; legacy namespaces require explicit admin association. */
export async function platformMerchant(prisma: PrismaService, context: PlatformContext, externalMerchantId: string) {
  let merchant = await prisma.integrationMerchant.findUnique({ where: { integrationKey_externalMerchantId: { integrationKey: `platform:${context.id}`, externalMerchantId } }, include: { user: true } });
  if (!merchant) {
    const binding = await prisma.platformIntegration.findUnique({ where: { platformId_key: { platformId: context.id, key: 'LEGACY_MERCHANT_KEYS' } } });
    const keys = binding?.url?.split(',').map(key => key.trim()).filter(Boolean) ?? [];
    const matches = keys.length ? await prisma.integrationMerchant.findMany({ where: { externalMerchantId, integrationKey: { in: keys } }, include: { user: true } }) : [];
    if (matches.length > 1) throw new ConflictException('Comerciante exige associação sem ambiguidade');
    merchant = matches[0] ?? null;
    if (merchant && (await resolveLegacyMerchantPlatform(prisma, merchant.integrationKey)).id !== context.id) throw new ConflictException('Vínculo legado pertence a outra plataforma');
  }
  if (context.delivery && merchant?.id !== context.delivery.merchantId) throw new ConflictException('Vínculo do comerciante mudou');
  if (!merchant?.user.isActive || merchant.user.isPurged) throw new NotFoundException('Comerciante não associado ou inativo');
  return merchant;
}
