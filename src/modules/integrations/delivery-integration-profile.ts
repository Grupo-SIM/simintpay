import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';

/** The Delivery ledger uses the same acquiring account as the SIM INT PAY admin. */
export async function ensureDeliveryProfile(db: Pick<Prisma.TransactionClient, 'paymentIntegrationProfile'>) {
  let profile = await db.paymentIntegrationProfile.findUnique({ where: { code: 'DELIVERY' } });
  if (!profile) {
    const token = process.env.DOM_TOKEN?.trim() || process.env.API_DOM_MASTER_KEY?.trim();
    if (!token) throw new UnprocessableEntityException({
      code: 'DELIVERY_PROFILE_NOT_CONFIGURED',
      message: 'Credencial DOM central não configurada: informe DOM_TOKEN ou API_DOM_MASTER_KEY no backend SIM INT PAY.',
    });
    // Concurrent company registrations share the profile, without rotating an existing account.
    profile = await db.paymentIntegrationProfile.upsert({
      where: { code: 'DELIVERY' },
      create: { code: 'DELIVERY', acquirer: 'DOM', encryptedCredential: encryptPlatformSecret(token) },
      update: {},
    });
  }
  if (!profile.isActive || profile.acquirer !== 'DOM') throw new UnprocessableEntityException({
    code: 'DELIVERY_PROFILE_NOT_CONFIGURED',
    message: 'Perfil DOM central do Delivery está desativado ou possui adquirente incompatível.',
  });
  return profile;
}
