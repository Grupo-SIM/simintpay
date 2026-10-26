import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRegisteredPlatform } from '../../modules/module.registry';
import { canonicalPlatformTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';
import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';

type PlatformActor = { id: string; role?: string; platform?: { tag: string } | null; ownedPlatforms?: { tag: string }[] };

/** A financial operation has one explicit platform; no inference from descriptions or owner order. */
export function assertExplicitPlatform(actor: PlatformActor | null | undefined, selected: string[] | undefined, allowAdmin = false): string | null {
  if (!selected?.length) {
    if ((actor?.ownedPlatforms?.length ?? 0) > 1) throw new BadRequestException('Selecione uma plataforma: conta possui vários produtos');
    return null;
  }
  const tags = [...new Set(selected.map(canonicalPlatformTaxaTag))];
  if (tags.length !== 1) throw new BadRequestException('Selecione uma única plataforma por operação');
  const tag = tags[0];
  if (['GLOBAL', 'SIMINTPAY'].includes(tag)) return null;
  const platform = getRegisteredPlatform(tag);
  if (!platform) throw new BadRequestException('Plataforma não cadastrada ou inativa');
  const assignedMember = actor?.platform?.tag && canonicalPlatformTaxaTag(actor.platform.tag) === tag;
  if (platform.ownerUserId !== actor?.id && !assignedMember && !(allowAdmin && actor?.role === 'ADMIN')) {
    throw new ForbiddenException('Plataforma não atribuída a esta conta');
  }
  return tag;
}

/** Registered platforms never fall back to another account's credentials. */
export function platformGatewayToken(tag: string | null | undefined, globalToken?: string | null): string | null {
  const normalized = canonicalPlatformTaxaTag(tag ?? 'GLOBAL');
  if (['GLOBAL', 'SIMINTPAY'].includes(normalized) || normalized.startsWith('CLIENT:')) return globalToken ?? null;
  if (!getRegisteredPlatform(normalized)) throw new BadRequestException('Plataforma não cadastrada ou inativa');
  const token = getPlatformIntegrationValue(normalized, 'DOM_TOKEN');
  if (!token) throw new BadRequestException('Credencial da plataforma não configurada');
  return token;
}
