export const ATLAS_PRODUCT_TYPES = ['DOMAIN', 'HOSTING'] as const;

export type AtlasProductType = (typeof ATLAS_PRODUCT_TYPES)[number];

/**
 * Product descriptions sent by Atlas start with their report category:
 * `DOMAIN teron.app` or `HOSTING VPS-10-1784846`.
 */
export function getAtlasProductType(description: string | null | undefined): AtlasProductType | null {
  const match = description?.trim().match(/^(DOMAIN|HOSTING)\s+\S/i);
  return match ? match[1].toUpperCase() as AtlasProductType : null;
}
