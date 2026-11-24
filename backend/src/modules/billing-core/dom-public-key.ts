import { canonicalPlatformTaxaTag } from '../platform-taxas/platform-taxas.store';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

/**
 * Public key the checkout hands to the DOM SDK (`getTokenCard`). There is a single DOM account,
 * so every platform uses the global key (`DOM_PUBLIC_KEY` env override, else the checkout key).
 * A platform may still override it with its own `DOM_PUBLIC_KEY` integration. It is public by
 * design and never the private API token.
 */
export const GLOBAL_DOM_PUBLIC_KEY = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';

export function resolveDomPublicKey(
  tag: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const normalized = canonicalPlatformTaxaTag(tag ?? 'GLOBAL');
  const platformKey = ['GLOBAL', 'SIMINTPAY'].includes(normalized)
    ? undefined
    : getPlatformIntegrationValue(normalized, 'DOM_PUBLIC_KEY');
  return platformKey || env.DOM_PUBLIC_KEY || GLOBAL_DOM_PUBLIC_KEY;
}
