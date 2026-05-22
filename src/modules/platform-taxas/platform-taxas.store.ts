import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  PLATFORM_TAXA_DEFAULTS,
  PLATAFORMA_TAXA_KEYS,
  type PlataformaTaxaKey,
} from './platform-taxas.keys';

type Overrides = Record<string, Record<string, number>>;

let prisma: PrismaClient;

function getPrisma(): PrismaClient {
  if (!prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      const pool = new Pool({ connectionString });
      const adapter = new PrismaPg(pool);
      prisma = new PrismaClient({ adapter });
    } else {
      prisma = new PrismaClient();
    }
  }
  return prisma;
}

let overridesCache: Overrides = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 30 * 1000;
let isFetching = false;

// Overrides that must exist for these platforms but may be missing due to prior misconfiguration.
const REQUIRED_OVERRIDES: Array<{ tag: string; key: string; value: number }> = [
  { tag: 'AREAFLIX', key: 'MDR_CC_1X', value: 0.0399 },
  { tag: 'PAGATG',   key: 'MDR_CC_1X', value: 0.0399 },
];

export async function initializePlatformTaxasCache(): Promise<void> {
  try {
    const records = await getPrisma().platformTaxaOverride.findMany();
    const newCache: Overrides = {};
    for (const req of records) {
      if (!newCache[req.tag]) {
        newCache[req.tag] = {};
      }
      newCache[req.tag][req.key] = req.value;
    }

    // Ensure required overrides exist in both cache and DB.
    // Only inserts if the platform has no explicit value for that key.
    const toInsert: Array<{ tag: string; key: string; value: number }> = [];
    for (const { tag, key, value } of REQUIRED_OVERRIDES) {
      if (newCache[tag]?.[key] === undefined) {
        if (!newCache[tag]) newCache[tag] = {};
        newCache[tag][key] = value;
        toInsert.push({ tag, key, value });
      }
    }
    // Inject MDR_CC_1X = 0.0399 for every active community slug that has no explicit override
    try {
      const communityRows = await getPrisma().community.findMany({
        where: { isActive: true },
        select: { slug: true },
      });
      for (const { slug } of communityRows) {
        const tag = slug.toUpperCase();
        if (newCache[tag]?.['MDR_CC_1X'] === undefined) {
          if (!newCache[tag]) newCache[tag] = {};
          newCache[tag]['MDR_CC_1X'] = 0.0399;
          toInsert.push({ tag, key: 'MDR_CC_1X', value: 0.0399 });
        }
      }
    } catch {
      // non-fatal: community slugs will fall back to global default
    }

    if (toInsert.length > 0) {
      await Promise.all(
        toInsert.map(({ tag, key, value }) =>
          getPrisma().platformTaxaOverride.upsert({
            where: { tag_key: { tag, key } },
            update: { value },
            create: { tag, key, value },
          }),
        ),
      );
    }

    overridesCache = newCache;
    lastCacheUpdate = Date.now();
  } catch (err: unknown) {
    console.error('Failed to initialize platform taxa overrides from DB', err);
  }
}

/**
 * Remove stale per-platform overrides that were superseded by a new global default.
 * Currently cleans up ATLAS.MDR_CC_1X = 0.0399 (old DOM rate, now absorbed — global default is 0).
 */
export async function cleanupStaleOverrides(): Promise<void> {
  try {
    const STALE: Array<{ tag: string; key: string; staleValue: number }> = [
      { tag: 'ATLAS', key: 'MDR_CC_1X', staleValue: 0.0399 },
    ];
    let changed = false;
    for (const { tag, key, staleValue } of STALE) {
      const record = await getPrisma().platformTaxaOverride.findUnique({
        where: { tag_key: { tag, key } },
      });
      if (record && Math.abs(record.value - staleValue) < 1e-6) {
        await getPrisma().platformTaxaOverride.delete({ where: { tag_key: { tag, key } } });
        console.log(`[platform-taxas] Removed stale override ${tag}.${key} = ${staleValue}`);
        changed = true;
      }
    }
    if (changed) lastCacheUpdate = 0;
  } catch (err: unknown) {
    console.error('[platform-taxas] cleanupStaleOverrides failed', err);
  }
}

function refreshCacheAsync(): void {
  if (isFetching) return;
  isFetching = true;
  initializePlatformTaxasCache().finally(() => {
    isFetching = false;
  });
}

/** Tag canônica na UI (EBOOK); variáveis de ambiente do ebook usam prefixo EBOOKSIM_. */
const ENV_PREFIX_BY_CANONICAL_TAG: Record<string, string> = {
  EBOOK: 'EBOOKSIM',
  'CONTROLE-MOTORISTA': 'CONTROLE_MOTORISTA',
  'CONTROLE-PATRIMONIAL': 'CONTROLE_PATRIMONIAL',
};

export function canonicalPlatformTaxaTag(tag: string): string {
  const u = String(tag || '').toUpperCase();
  if (u === 'EBOOKSIM') return 'EBOOK';
  return u;
}

function envPrefixForCanonical(canonical: string): string {
  return ENV_PREFIX_BY_CANONICAL_TAG[canonical] ?? canonical;
}

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

export function readOverridesRaw(): Overrides {
  const now = Date.now();
  if (now - lastCacheUpdate > CACHE_TTL) {
    refreshCacheAsync();
  }
  return overridesCache;
}

/** Antigo padrão DOM PIX 0,98% (decimal 0,0098). Overrides/env antigos: mapear para `MDR_PIX` atual das keys. */
const LEGACY_MDR_PIX_098 = 0.0098;

function finalizeResolvedTaxa(keySuffix: string, value: number): number {
  if (keySuffix !== 'MDR_PIX') return value;
  if (!Number.isFinite(value)) return PLATFORM_TAXA_DEFAULTS.MDR_PIX;
  if (Math.abs(value - LEGACY_MDR_PIX_098) < 1e-9) {
    return PLATFORM_TAXA_DEFAULTS.MDR_PIX;
  }
  return value;
}

export function getPlatformTaxaEffective(
  listOrModuleTag: string,
  keySuffix: string,
  fallback: number,
): number {
  const canonical = canonicalPlatformTaxaTag(listOrModuleTag);
  const overrides = readOverridesRaw();

  // 1º: override específico da plataforma
  const platformRow = overrides[canonical];
  const platformOverride = platformRow?.[keySuffix];
  if (platformOverride !== undefined && Number.isFinite(Number(platformOverride))) {
    return finalizeResolvedTaxa(keySuffix, Number(platformOverride));
  }

  // 2º: variável de ambiente específica da plataforma
  const envTag = envPrefixForCanonical(canonical);
  const envKey = `${envTag}_${keySuffix}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined && envVal !== '') {
    const n = parseEnvNumber(envVal, NaN);
    if (Number.isFinite(n)) return finalizeResolvedTaxa(keySuffix, n);
  }

  // 3º: override global (tag GLOBAL)
  if (canonical !== 'GLOBAL') {
    const globalRow = overrides['GLOBAL'];
    const globalOverride = globalRow?.[keySuffix];
    if (globalOverride !== undefined && Number.isFinite(Number(globalOverride))) {
      return finalizeResolvedTaxa(keySuffix, Number(globalOverride));
    }
  }

  // 4º: fallback (default do código)
  return finalizeResolvedTaxa(keySuffix, parseEnvNumber(undefined, fallback));
}

export function getPlatformTaxaSource(
  listOrModuleTag: string,
  keySuffix: string,
): 'override' | 'global' | 'env' {
  const canonical = canonicalPlatformTaxaTag(listOrModuleTag);
  const overrides = readOverridesRaw();

  const platformRow = overrides[canonical];
  if (platformRow && Object.prototype.hasOwnProperty.call(platformRow, keySuffix)) {
    return 'override';
  }

  const envTag = envPrefixForCanonical(canonical);
  const envKey = `${envTag}_${keySuffix}`;
  if (process.env[envKey] !== undefined && process.env[envKey] !== '') return 'env';

  if (canonical !== 'GLOBAL') {
    const globalRow = overrides['GLOBAL'];
    if (globalRow && Object.prototype.hasOwnProperty.call(globalRow, keySuffix)) {
      return 'global';
    }
  }

  return 'env';
}

function isAllowedKey(k: string): k is PlataformaTaxaKey {
  return (PLATAFORMA_TAXA_KEYS as readonly string[]).includes(k);
}

export function applyPatchToOverrides(
  tagParam: string,
  patch: Record<string, number | null>,
): Overrides {
  const canonical = canonicalPlatformTaxaTag(tagParam);
  const all: Overrides = { ...readOverridesRaw() };
  const prev = { ...(all[canonical] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (!isAllowedKey(k)) continue;
    if (v === null) {
      delete prev[k];
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Valor inválido para ${k}`);
    }
    prev[k] = v;
  }
  all[canonical] = prev;
  return all;
}

export async function writeOverrides(data: Overrides): Promise<void> {
  const newItems: { tag: string; key: string; value: number }[] = [];
  for (const [tag, keys] of Object.entries(data)) {
    for (const [key, value] of Object.entries(keys)) {
      newItems.push({ tag, key, value });
    }
  }

  // Persiste no banco antes de atualizar o cache: se falhar, lança erro para o chamador
  await getPrisma().$transaction([
    getPrisma().platformTaxaOverride.deleteMany(),
    getPrisma().platformTaxaOverride.createMany({ data: newItems }),
  ]);

  overridesCache = JSON.parse(JSON.stringify(data));
  lastCacheUpdate = Date.now();
}

export function defaultTaxaValue(key: PlataformaTaxaKey): number {
  return PLATFORM_TAXA_DEFAULTS[key];
}
