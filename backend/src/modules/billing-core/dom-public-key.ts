import { BadRequestException } from '@nestjs/common';
import { canonicalPlatformTaxaTag } from '../platform-taxas/platform-taxas.store';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

/**
 * Public key the checkout hands to the DOM SDK (`getTokenCard`). There is a single DOM account,
 * so every platform uses the `DOM_PUBLIC_KEY` env value. A platform may still override it with its own `DOM_PUBLIC_KEY` integration. It is public by
 * design and never the private API token.
 */
export function resolveDomPublicKey(
  tag: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const normalized = canonicalPlatformTaxaTag(tag ?? 'GLOBAL');
  const platformKey = ['GLOBAL', 'SIMINTPAY'].includes(normalized)
    ? undefined
    : getPlatformIntegrationValue(normalized, 'DOM_PUBLIC_KEY');
  const key = platformKey || env.DOM_PUBLIC_KEY;
  if (!key)
    throw new BadRequestException(
      'Chave pública do adquirente não configurada',
    );
  return key;
}
