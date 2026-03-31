import * as fs from 'fs';
import * as path from 'path';
import {
  PLATFORM_TAXA_DEFAULTS,
  PLATAFORMA_TAXA_KEYS,
  type PlataformaTaxaKey,
} from './platform-taxas.keys';

type Overrides = Record<string, Record<string, number>>;

const STORAGE_DIR = path.join(process.cwd(), 'storage');
const STORAGE_FILE = path.join(STORAGE_DIR, 'platform-taxas-overrides.json');

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
  try {
    const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
    const j = JSON.parse(raw) as Overrides;
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

export function getPlatformTaxaEffective(
  listOrModuleTag: string,
  keySuffix: string,
  fallback: number,
): number {
  const canonical = canonicalPlatformTaxaTag(listOrModuleTag);
  const row = readOverridesRaw()[canonical];
  const o = row?.[keySuffix];
  if (o !== undefined && Number.isFinite(Number(o))) return Number(o);
  const envTag = envPrefixForCanonical(canonical);
  const envKey = `${envTag}_${keySuffix}`;
  return parseEnvNumber(process.env[envKey], fallback);
}

export function getPlatformTaxaSource(
  listOrModuleTag: string,
  keySuffix: string,
): 'override' | 'env' {
  const canonical = canonicalPlatformTaxaTag(listOrModuleTag);
  const row = readOverridesRaw()[canonical];
  if (row && Object.prototype.hasOwnProperty.call(row, keySuffix)) return 'override';
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
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function defaultTaxaValue(key: PlataformaTaxaKey): number {
  return PLATFORM_TAXA_DEFAULTS[key];
}
