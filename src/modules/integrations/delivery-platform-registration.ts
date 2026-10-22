import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export async function reserveDeliveryPlatform(tx: Prisma.TransactionClient, integrationKey: string, externalMerchantId: string, name: string) {
  if (!/^sim-delivery_[a-z0-9][a-z0-9_-]*$/.test(integrationKey) || !externalMerchantId.trim() || !name.trim()) throw new BadRequestException('Empresa Sim Delivery inválida');
  const registration = await tx.deliveryPlatformRegistration.upsert({
    where: { externalMerchantId },
    create: { integrationKey, externalMerchantId, name: name.trim() }, update: {},
  });
  if (registration.integrationKey !== integrationKey) {
    if (registration.platformId) throw new ConflictException('Empresa já vinculada com outra integração');
    // Before activation, company ID remains authoritative if the Delivery slug changes.
    return tx.deliveryPlatformRegistration.update({
      where: { id: registration.id, platformId: null }, data: { integrationKey, name: name.trim() },
    });
  }
  return registration;
}
