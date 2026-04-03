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
    overridesCache = newCache;
    lastCacheUpdate = Date.now();
  } catch (err: unknown) {
    console.error('Failed to initialize platform taxa overrides from DB', err);
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
    return Number(platformOverride);
  }

  // 2º: variável de ambiente específica da plataforma
  const envTag = envPrefixForCanonical(canonical);
  const envKey = `${envTag}_${keySuffix}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined && envVal !== '') {
    const n = parseEnvNumber(envVal, NaN);
    if (Number.isFinite(n)) return n;
  }

  // 3º: override global (tag GLOBAL)
  if (canonical !== 'GLOBAL') {
    const globalRow = overrides['GLOBAL'];
    const globalOverride = globalRow?.[keySuffix];
    if (globalOverride !== undefined && Number.isFinite(Number(globalOverride))) {
      return Number(globalOverride);
    }
  }

  // 4º: fallback (default do código)
  return parseEnvNumber(undefined, fallback);
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
  patch: Record<string, number>,
): Overrides {
  const canonical = canonicalPlatformTaxaTag(tagParam);
  const all: Overrides = { ...readOverridesRaw() };
  const prev = { ...(all[canonical] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (!isAllowedKey(k)) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Valor inválido para ${k}`);
    }
    prev[k] = v;
  }
  all[canonical] = prev;
  return all;
}

export function writeOverrides(data: Overrides): void {
  // Atualiza cache em memória imediatamente
  overridesCache = JSON.parse(JSON.stringify(data));
  lastCacheUpdate = Date.now();

  // Persiste no banco de dados de forma assíncrona
  void (async () => {
    try {
      const newItems = [];
      for (const [tag, keys] of Object.entries(data)) {
        for (const [key, value] of Object.entries(keys)) {
          newItems.push({ tag, key, value });
        }
      }

      await getPrisma().$transaction([
        getPrisma().platformTaxaOverride.deleteMany(),
        getPrisma().platformTaxaOverride.createMany({ data: newItems }),
      ]);
    } catch (e) {
      console.error('Failed to write overrides to DB', e);
    }
  })();
}

export function defaultTaxaValue(key: PlataformaTaxaKey): number {
  return PLATFORM_TAXA_DEFAULTS[key];
}
