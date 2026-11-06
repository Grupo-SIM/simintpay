import { BadRequestException } from '@nestjs/common';
import { canonicalPlatformTaxaTag } from '../platform-taxas/platform-taxas.store';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

/**
 * Public key the checkout hands to the DOM SDK (`getTokenCard`). It is the same key the
 * existing checkouts hardcode; the global account may override it with `DOM_PUBLIC_KEY`, and a
 * registered platform must configure its own `DOM_PUBLIC_KEY` integration (a token made with
 * another merchant's key would not belong to that platform's DOM account). It is public by
 * design and never the private API token.
 */
export const GLOBAL_DOM_PUBLIC_KEY = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';

export function resolveDomPublicKey(
  tag: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const normalized = canonicalPlatformTaxaTag(tag ?? 'GLOBAL');
  if (
    ['GLOBAL', 'SIMINTPAY'].includes(normalized) ||
    /^(CLIENT:|USER:)/.test(normalized)
  )
    return env.DOM_PUBLIC_KEY || GLOBAL_DOM_PUBLIC_KEY;
  const key = getPlatformIntegrationValue(normalized, 'DOM_PUBLIC_KEY');
  if (!key)
    throw new BadRequestException(
      'Chave pública do adquirente da plataforma não configurada',
    );
  return key;
}
