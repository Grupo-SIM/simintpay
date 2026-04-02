import { Injectable, BadRequestException } from '@nestjs/common';
import {
  canonicalPlatformTaxaTag,
  defaultTaxaValue,
  getPlatformTaxaEffective,
  getPlatformTaxaSource,
  readOverridesRaw,
  applyPatchToOverrides,
  writeOverrides,
} from '../../modules/platform-taxas/platform-taxas.store';
import {
  PLATAFORMA_TAXA_KEYS,
  type PlataformaTaxaKey,
} from '../../modules/platform-taxas/platform-taxas.keys';

const KNOWN_CANONICAL_TAGS = [
  'GLOBAL',
  'RENOVADA',
  'REVALIDA',
  'BOSQUE',
  'PAGATG',
  'EBOOK',
  'FRENDZ',
] as const;

export type PlataformaTaxaSourceMap = Record<
  string,
  Partial<Record<PlataformaTaxaKey, 'env' | 'override' | 'global'>>
>;

@Injectable()
export class PlatformTaxasService {
  getTaxasResponse(extraTags?: string[]) {
    const set = new Set<string>(KNOWN_CANONICAL_TAGS);
    for (const k of Object.keys(readOverridesRaw())) {
      set.add(canonicalPlatformTaxaTag(k));
    }
    for (const t of extraTags ?? []) {
      set.add(canonicalPlatformTaxaTag(t));
    }

    const data: Record<string, Partial<Record<PlataformaTaxaKey, number>>> = {};
    const sources: PlataformaTaxaSourceMap = {};

    for (const tag of [...set].sort()) {
      const row: Partial<Record<PlataformaTaxaKey, number>> = {};
      const srcRow: Partial<Record<PlataformaTaxaKey, 'env' | 'override' | 'global'>> = {};
      for (const key of PLATAFORMA_TAXA_KEYS) {
        const fb = defaultTaxaValue(key);
        row[key] = getPlatformTaxaEffective(tag, key, fb);
        srcRow[key] = getPlatformTaxaSource(tag, key);
      }
      data[tag] = row;
      sources[tag] = srcRow;
    }

    return {
      data,
      meta: { sources },
    };
  }

  patchPlatform(tag: string, body: Record<string, unknown>) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Body inválido');
    }
    const patch: Record<string, number> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(PLATAFORMA_TAXA_KEYS as readonly string[]).includes(k)) {
        throw new BadRequestException(`Chave não permitida: ${k}`);
      }
      const n =
        typeof v === 'number'
          ? v
          : typeof v === 'string'
            ? Number(String(v).replace(',', '.'))
            : NaN;
      if (!Number.isFinite(n)) {
        throw new BadRequestException(`Número inválido: ${k}`);
      }
      patch[k] = n;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nenhuma taxa para atualizar');
    }
    try {
      const next = applyPatchToOverrides(tag, patch);
      writeOverrides(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao persistir';
      throw new BadRequestException(msg);
    }
    return this.getTaxasResponse([tag]);
  }
}
