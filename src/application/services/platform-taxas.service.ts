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
  'AREAFLIX',
  'FRENDZ',
  'ATLAS',
  'COMUNIDADE',
  'CONTROLE-MOTORISTA',
  'CONTROLE-PATRIMONIAL',
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

    // Taxas DOM fixas para links de pagamento (cobradas do comprador, não configuráveis)
    const DOM_LINK_RATES: Record<string, number> = {
      DOM_LINK_1X:  0.0000,
      DOM_LINK_2X:  0.0451,
      DOM_LINK_3X:  0.0604,
      DOM_LINK_4X:  0.0759,
      DOM_LINK_5X:  0.0915,
      DOM_LINK_6X:  0.1072,
      DOM_LINK_7X:  0.1231,
      DOM_LINK_8X:  0.1392,
      DOM_LINK_9X:  0.1554,
      DOM_LINK_10X: 0.1717,
      DOM_LINK_11X: 0.1882,
      DOM_LINK_12X: 0.2048,
    };

    return {
      data,
      meta: { sources, domLinkRates: DOM_LINK_RATES },
    };
  }

  async patchPlatform(tag: string, body: Record<string, unknown>) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Body inválido');
    }
    const patch: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(PLATAFORMA_TAXA_KEYS as readonly string[]).includes(k)) {
        throw new BadRequestException(`Chave não permitida: ${k}`);
      }
      if (k === 'TAXA_FIXA_TRANSACAO' || k === 'TAXA_CASHBACK') {
        throw new BadRequestException(`Chave é fixa e não pode ser alterada: ${k}`);
      }
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
      await writeOverrides(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao persistir';
      throw new BadRequestException(msg);
    }
    return this.getTaxasResponse([tag]);
  }
}
