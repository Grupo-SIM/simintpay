import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { PlatformContext } from './platform-context.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';

export async function deliveryProfile(prisma: PrismaService, context: PlatformContext) {
  if (!context.delivery) throw new ForbiddenException('Credencial Delivery obrigatória');
  const credential = await prisma.platformApiCredential.findUnique({ where: { id: context.delivery.credentialId }, include: { profile: true } });
  if (!credential?.isActive || credential.source !== 'delivery' || credential.platformId !== context.id || credential.merchantId !== context.delivery.merchantId || credential.externalCompanyId !== context.delivery.externalCompanyId || !credential.profile.isActive || credential.profile.acquirer !== context.acquirer) throw new ForbiddenException('Credencial ou perfil alterado');
  if (credential.profile.code !== 'DELIVERY') throw new UnprocessableEntityException({ code: 'DELIVERY_PROFILE_NOT_CONFIGURED' });
  return { credential, token: decryptPlatformSecret(credential.profile.encryptedCredential) };
}
