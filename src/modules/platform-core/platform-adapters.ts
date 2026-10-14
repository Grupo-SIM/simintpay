import { UnprocessableEntityException } from '@nestjs/common';

export const CORPORATE_PLATFORM_TAGS = new Set([
  'ATLAS', 'ZERO-GRAU', 'CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL',
  'EBOOK', 'BOSQUE', 'RENOVADA', 'AREAFLIX', 'PAGATG', 'RETURN-BET', 'BETAI', 'REVALIDA', 'MASTER', 'VIVENDO-DE-BET',
]);

export function unsupportedCapability(capability: string): never {
  throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability, message: 'Capacidade indisponível' });
}

export interface PlatformBusinessAdapter {
  readonly kind: string;
  readonly capabilities: readonly string[];
}
const generic: PlatformBusinessAdapter = { kind: 'generic', capabilities: ['payments', 'finance', 'reports', 'events'] };
const corporate = new Map<string, PlatformBusinessAdapter>([...CORPORATE_PLATFORM_TAGS].map((tag) => [tag, { kind: tag, capabilities: [...generic.capabilities.filter(capability => capability !== 'payments' || ['ATLAS', 'BOSQUE', 'RENOVADA', 'ZERO-GRAU'].includes(tag)), ...(tag === 'ATLAS' ? ['mail.vm-access'] : tag === 'RETURN-BET' ? ['community.status', 'withdrawal-policy'] : [])] }]));

/** Selection occurs only after resolving an explicitly registered, active platform. */
export function platformAdapter(tag: string): PlatformBusinessAdapter {
  return corporate.get(tag) ?? generic;
}
