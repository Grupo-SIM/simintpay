import { createHash, randomBytes } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { reserveDeliveryPlatform } from './delivery-platform-registration';
import { encryptPlatformSecret, hashPlatformToken } from '../platform-integrations/platform-secrets';

/** Runs inside owner provisioning's transaction: no orphan account or partial binding. */
export async function ensureDeliveryOwnerPlatform(tx: Prisma.TransactionClient, integrationKey: string, externalMerchantId: string, ownerUserId: string, name: string) {
  const registration = await reserveDeliveryPlatform(tx, integrationKey, externalMerchantId, name);
  const complete = async (platform: { id: string }) => {
    if (registration.platformId && registration.platformId !== platform.id) throw new ConflictException('Reserva já vinculada a outra plataforma');
    await tx.deliveryPlatformRegistration.update({ where: { id: registration.id }, data: { platformId: platform.id } });
    return platform;
  };
  // Include inactive platforms: never silently replace a disabled or ambiguous binding.
  const bindings = await tx.platformIntegration.findMany({
    where: { key: 'LEGACY_MERCHANT_KEYS' }, include: { platform: { include: { owner: true } } },
  });
  const matches = bindings.filter(row => row.url?.split(',').some(key => key.trim() === integrationKey));
  if (matches.length > 1) throw new ConflictException('Integração vinculada a múltiplas plataformas; exige revisão administrativa');
  if (matches.length === 1) {
    const platform = matches[0].platform;
    if (!platform.isActive || !platform.owner.isActive || platform.owner.isPurged) throw new ConflictException('Plataforma vinculada inativa; exige revisão administrativa');
    return complete(platform);
  }

  // Legacy merchants already have a durable owner ID. Preserve its unique platform
  // instead of creating another platform that cannot read the historical tenant marker.
  const owned = await tx.platform.findMany({ where: { ownerUserId }, include: { owner: true } });
  if (owned.length > 1) throw new ConflictException('Titular possui múltiplas plataformas; exige associação explícita');
  if (owned.length === 1) {
    const platform = owned[0];
    if (!platform.isActive || !platform.owner.isActive || platform.owner.isPurged) throw new ConflictException('Plataforma histórica inativa; exige revisão administrativa');
    const binding = await tx.platformIntegration.findUnique({ where: { platformId_key: { platformId: platform.id, key: 'LEGACY_MERCHANT_KEYS' } } });
    if (binding?.url?.trim()) throw new ConflictException('Plataforma histórica já possui outro vínculo; exige revisão administrativa');
    await tx.platformIntegration.upsert({
      where: { platformId_key: { platformId: platform.id, key: 'LEGACY_MERCHANT_KEYS' } },
      create: { platformId: platform.id, key: 'LEGACY_MERCHANT_KEYS', url: integrationKey },
      update: { url: integrationKey },
    });
    return complete(platform);
  }

  // Company ID gives a stable, bounded tag independent of display name and slug changes.
  const tag = `SIM-DELIVERY-${createHash('sha256').update(externalMerchantId).digest('hex').slice(0, 32).toUpperCase()}`;
  const existing = await tx.platform.findUnique({ where: { tag } });
  if (existing) {
    if (existing.ownerUserId !== ownerUserId || !existing.isActive) throw new ConflictException('Plataforma já cadastrada com outro dono ou inativa');
    // Never overwrite a platform's preexisting association or credentials.
    const binding = await tx.platformIntegration.findUnique({ where: { platformId_key: { platformId: existing.id, key: 'LEGACY_MERCHANT_KEYS' } } });
    if (binding?.url?.trim()) throw new ConflictException('Plataforma já possui outro vínculo; exige revisão administrativa');
    await tx.platformIntegration.upsert({
      where: { platformId_key: { platformId: existing.id, key: 'LEGACY_MERCHANT_KEYS' } },
      create: { platformId: existing.id, key: 'LEGACY_MERCHANT_KEYS', url: integrationKey },
      update: { url: integrationKey },
    });
    return complete(existing);
  }
  const token = randomBytes(32).toString('hex');
  const platform = await tx.platform.create({ data: {
    id: registration.id, tag, name, ownerUserId, isActive: true, absorbCustomerInterest: true,
    integrations: { create: [
      { key: 'LEGACY_MERCHANT_KEYS', url: integrationKey },
      { key: 'INBOUND_TOKEN', encryptedValue: encryptPlatformSecret(token), tokenHash: hashPlatformToken(token) },
      { key: 'INBOUND_OPERATIONS', url: 'payments:create,payments:read,finance:read,finance:withdraw,merchants:manage,sync:run' },
      { key: 'WEBHOOK_SECRET', encryptedValue: encryptPlatformSecret(randomBytes(32).toString('hex')) },
    ] },
  } });
  return complete(platform);
}
