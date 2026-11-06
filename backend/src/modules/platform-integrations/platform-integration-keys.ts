/** Used when no explicit INBOUND_OPERATIONS configuration exists. */
export const DEFAULT_INBOUND_OPERATIONS = [
  'events:read',
  'finance:read',
  'finance:withdraw',
  'links:read',
  'links:write',
  'payments:create',
  'payments:read',
  'subscriptions:read',
  'subscriptions:write',
  'vouchers:read',
  'vouchers:write',
] as const;

/** Configuration keys are shared by migration, adapters and management APIs. */
export const PLATFORM_INTEGRATION_KEYS = [
  'EXTERNAL_DATABASE_URL',
  'DOM_TOKEN',
  'DOM_PUBLIC_KEY',
  'BACKEND_URL',
  'INTERNAL_TOKEN',
  'API_TOKEN',
  'API_URL',
  'FRENDZ_TOKEN',
  'WEBHOOK_URL',
  'WEBHOOK_SECRET',
  'ENABLE_DOM_SYNC',
  'EMAIL_LOGO_URL',
  'ENTRY_LINK_ID',
  'CLAIM_SOURCE_USER_ID',
  'INBOUND_TOKEN',
  'INBOUND_OPERATIONS',
  'LEGACY_MERCHANT_KEYS',
  'DOM_WEBHOOK_SECRET',
  'MACHINE_SERIALS',
  'MACHINE_DOCUMENTS',
  'OFFER_HASH',
  'WEBHOOK_RELAXED',
] as const;
export const PLATFORM_URL_KEYS = new Set<string>([
  'BACKEND_URL',
  'API_URL',
  'WEBHOOK_URL',
  'EMAIL_LOGO_URL',
]);
export const PLATFORM_PUBLIC_VALUE_KEYS = new Set<string>([
  ...PLATFORM_URL_KEYS,
  'CLAIM_SOURCE_USER_ID',
  'ENABLE_DOM_SYNC',
  'ENTRY_LINK_ID',
  'MACHINE_SERIALS',
  'MACHINE_DOCUMENTS',
  'WEBHOOK_RELAXED',
  'INBOUND_OPERATIONS',
  'LEGACY_MERCHANT_KEYS',
]);
