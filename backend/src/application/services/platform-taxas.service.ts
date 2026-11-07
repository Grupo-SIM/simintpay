import {
  getRegisteredPlatform,
  registeredPlatformTags,
} from '../../modules/module.registry';
import { Injectable, BadRequestException } from '@nestjs/common';
import {
  canonicalPlatformTaxaTag,
  defaultTaxaValue,
  getPlatformTaxaEffective,
  getPlatformTaxaSource,
  patchPlatformOverrides,
} from '../../modules/platform-taxas/platform-taxas.store';
import {
  EDITABLE_PLATFORM_TAXA_KEYS,
  type PlataformaTaxaKey,
} from '../../modules/platform-taxas/platform-taxas.keys';

export type PlataformaTaxaSourceMap = Record<
  string,
  Partial<Record<PlataformaTaxaKey, 'default' | 'override' | 'global'>>
>;

@Injectable()
export class PlatformTaxasService {
  getTaxasResponse(extraTags?: string[]) {
    const set = new Set<string>(['GLOBAL', ...registeredPlatformTags()]);
    for (const t of extraTags ?? []) {
      set.add(canonicalPlatformTaxaTag(t));
    }

    const data: Record<string, Partial<Record<PlataformaTaxaKey, number>>> = {};
    const sources: PlataformaTaxaSourceMap = {};

    for (const tag of [...set].sort()) {
      const row: Partial<Record<PlataformaTaxaKey, number>> = {};
      const srcRow: Partial<
        Record<PlataformaTaxaKey, 'default' | 'override' | 'global'>
      > = {};
      for (const key of EDITABLE_PLATFORM_TAXA_KEYS) {
        const fb = defaultTaxaValue(key);
        row[key] = getPlatformTaxaEffective(tag, key, fb);
        srcRow[key] = getPlatformTaxaSource(tag, key);
      }
      data[tag] = row;
      sources[tag] = srcRow;
    }

    return { data, meta: { sources } };
  }

  /**
   * Taxas resolvidas de UMA tag (plataforma ou CLIENT:<email>), para a tela
   * somente-leitura do cliente. `isPersonalized` = o master definiu algum
   * override específico para este cliente (fonte 'override').
   */
  getResolvedTaxaForTag(tag: string) {
    const data: Partial<Record<PlataformaTaxaKey, number>> = {};
    const sources: Partial<
      Record<PlataformaTaxaKey, 'default' | 'override' | 'global'>
    > = {};

    for (const key of EDITABLE_PLATFORM_TAXA_KEYS) {
      data[key] = getPlatformTaxaEffective(tag, key, defaultTaxaValue(key));
      sources[key] = getPlatformTaxaSource(tag, key);
    }

    const isPersonalized = Object.values(sources).some((s) => s === 'override');

    return {
      tag: canonicalPlatformTaxaTag(tag),
      isPersonalized,
      data,
      sources,
    };
  }

  async patchPlatform(tag: string, body: Record<string, unknown>) {
    tag = canonicalPlatformTaxaTag(tag);
    if (tag !== 'GLOBAL' && !getRegisteredPlatform(tag))
      throw new BadRequestException('Plataforma não cadastrada');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Body inválido');
    }
    const patch: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(EDITABLE_PLATFORM_TAXA_KEYS as readonly string[]).includes(k))
        throw new BadRequestException(
          `Taxa legada: configure a política financeira em /admin/taxas (${k})`,
        );
      // null means "remove this platform override, fall back to global/default"
      if (v === null) {
        patch[k] = null;
        continue;
      }
      const n =
        typeof v === 'number'
          ? v
          : typeof v === 'string'
            ? Number(String(v).replace(',', '.'))
            : NaN;
      if (!Number.isFinite(n) || n < 0)
        throw new BadRequestException(`Número inválido: ${k}`);
      patch[k] = n;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nenhuma taxa para atualizar');
    }
    try {
      await patchPlatformOverrides(tag, patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao persistir';
      throw new BadRequestException(msg);
    }
    return this.getTaxasResponse([tag]);
  }
}
