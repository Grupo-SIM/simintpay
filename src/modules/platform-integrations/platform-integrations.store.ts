import type { PrismaClient } from '@prisma/client';
import { decryptPlatformSecret } from './platform-secrets';

let cache: Record<string, Record<string, string>> = {};
let prisma: PrismaClient | undefined;
let fetchedAt = 0;
let fetching: Promise<void> | undefined;

function canonicalTag(tag: string): string {
  const normalized = tag.trim().toUpperCase().replaceAll('_', '-');
  return normalized === 'EBOOKSIM' ? 'EBOOK' : normalized;
}

export async function initializePlatformIntegrationsCache(client?: PrismaClient): Promise<void> {
  if (client) prisma = client;
  if (!prisma) throw new Error('Cache de integrações não inicializado');
  const rows = await prisma.platformIntegration.findMany({
    where: { platform: { isActive: true, owner: { isActive: true, isPurged: false } } },
    include: { platform: { select: { tag: true } } },
  });
  const next: typeof cache = {};
  for (const row of rows) {
    const tag = canonicalTag(row.platform.tag);
    next[tag] ??= {};
    const value = row.encryptedValue ? decryptPlatformSecret(row.encryptedValue) : row.url;
    if (value) next[tag][row.key] = value;
  }
  cache = next;
  fetchedAt = Date.now();
}

export function getPlatformIntegrationValue(tag: string, key: string): string | null {
  if (prisma && Date.now() - fetchedAt > 30_000 && !fetching) {
    fetching = initializePlatformIntegrationsCache().catch(() => {
      // Old credentials must not remain usable after a failed refresh.
      cache = {};
    }).finally(() => { fetching = undefined; });
  }
  if (Date.now() - fetchedAt > 60_000) return null;
  return cache[canonicalTag(tag)]?.[key] ?? null;
}

export function invalidatePlatformIntegrationsCache(): void {
  cache = {};
  fetchedAt = 0;
}
