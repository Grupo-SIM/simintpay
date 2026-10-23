import { ensureDeliveryProfile } from './delivery-integration-profile';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decryptPlatformSecret, encryptPlatformSecret, hashPlatformToken } from '../platform-integrations/platform-secrets';

export const DELIVERY_OPERATIONS = ['customers:manage', 'cards:tokenize', 'payments:create', 'payments:read', 'payments:allocate', 'finance:read', 'finance:withdraw', 'merchants:manage', 'sync:run'];
export function assertDeliveryProvisioningToken(received?: string) {
  const expected = process.env.SIM_DELIVERY_PROVISIONING_TOKEN || process.env.SIM_DELIVERY_INTERNAL_TOKEN || process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected || typeof received !== 'string' || Buffer.byteLength(expected) !== Buffer.byteLength(received) || !timingSafeEqual(Buffer.from(expected), Buffer.from(received))) throw new UnauthorizedException('Credencial de provisionamento inválida');
}
export async function ensureDeliveryAccess(tx: Prisma.TransactionClient, platformId: string, merchant: { id: string; externalMerchantId: string }) {
  const existing = await tx.platformApiCredential.findUnique({ where: { externalCompanyId: merchant.externalMerchantId } });
  if (existing) {
    if (!existing.isActive || existing.platformId !== platformId || existing.merchantId !== merchant.id || existing.source !== 'delivery') throw new ConflictException('Credencial exige revisão administrativa');
    return existing;
  }
  const profile = await ensureDeliveryProfile(tx);
  const platformCredential = await tx.platformIntegration.findUnique({ where: { platformId_key: { platformId, key: 'DOM_TOKEN' } } });
  if (platformCredential?.encryptedValue && decryptPlatformSecret(platformCredential.encryptedValue) !== decryptPlatformSecret(profile.encryptedCredential)) throw new ConflictException({ code: 'DELIVERY_ACQUIRER_PROFILE_CONFLICT', message: 'Conta DOM existente difere do perfil Delivery; exige revisão administrativa' });
  // Explicit association also keeps the old transport usable during rollback.
  // Never overwrite an existing platform acquiring configuration.
  await tx.platformIntegration.upsert({ where: { platformId_key: { platformId, key: 'DOM_TOKEN' } }, create: { platformId, key: 'DOM_TOKEN', encryptedValue: profile.encryptedCredential }, update: {} });
  const token = randomBytes(32).toString('hex');
  return tx.platformApiCredential.create({ data: {
    source: 'delivery', externalCompanyId: merchant.externalMerchantId, platformId, merchantId: merchant.id, profileId: profile.id,
    tokenHash: hashPlatformToken(token), encryptedToken: encryptPlatformSecret(token),
    encryptedWebhookSecret: encryptPlatformSecret(randomBytes(32).toString('hex')), operations: DELIVERY_OPERATIONS,
  } });
}
export function deliveryAccessResult(credential: { encryptedToken: string; encryptedWebhookSecret: string }, platform: { id: string; tag: string }, merchant: { id: string }) {
  return { platform: { id: platform.id, tag: platform.tag }, merchant: { id: merchant.id }, credentials: {
    accessToken: decryptPlatformSecret(credential.encryptedToken), webhookSecret: decryptPlatformSecret(credential.encryptedWebhookSecret),
  } };
}
