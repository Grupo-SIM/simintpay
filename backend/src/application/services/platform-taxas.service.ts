import { calculatePaymentLinkFees } from '../use-cases/payment-link/payment-link-fees.helper';
import type { PaymentLink } from '@prisma/client';
import { getRegisteredPlatform, registeredPlatformTags } from '../../modules/module.registry';
import { Injectable, BadRequestException } from '@nestjs/common';
import {
  canonicalPlatformTaxaTag,
  defaultTaxaValue,
  getPlatformTaxaEffective,
  getPlatformTaxaSource,
  applyPatchToOverrides,
  patchPlatformOverrides,
} from '../../modules/platform-taxas/platform-taxas.store';
import {
  PLATAFORMA_TAXA_KEYS,
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
      const srcRow: Partial<Record<PlataformaTaxaKey, 'default' | 'override' | 'global'>> = {};
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

  /**
   * Taxas resolvidas de UMA tag (plataforma ou CLIENT:<email>), para a tela
   * somente-leitura do cliente. `isPersonalized` = o master definiu algum
   * override específico para este cliente (fonte 'override').
   */
  getResolvedTaxaForTag(tag: string) {
    const data: Partial<Record<PlataformaTaxaKey, number>> = {};
    const sources: Partial<Record<PlataformaTaxaKey, 'default' | 'override' | 'global'>> = {};

    for (const key of PLATAFORMA_TAXA_KEYS) {
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
    if (tag !== 'GLOBAL' && !tag.startsWith('CLIENT:') && !getRegisteredPlatform(tag)) throw new BadRequestException('Plataforma não cadastrada');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Body inválido');
    }
    const patch: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k.startsWith('MDR_LINK_')) {
        throw new BadRequestException('Juros do comprador devem ser configurados na plataforma pelo dono');
      }
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
      if (!Number.isFinite(n) || n < 0 || (k === "LIQUIDEZ" && n > 1) || ((k.startsWith("LINK_COST_") || k.startsWith("MDR_") || k.endsWith("_PERCENT")) && n > 1)) {
        throw new BadRequestException(`Número inválido: ${k}`);
      }
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
    const response = this.getTaxasResponse([tag]);
    const affected = tag === 'GLOBAL' ? registeredPlatformTags() : [tag];
    const warnings = affected.flatMap((platformTag) => Array.from({ length: 12 }, (_, index) => ({ platformTag, installments: index + 1, ...calculatePaymentLinkFees({ amount: 100, isStandalone: false } as unknown as PaymentLink, index + 1, platformTag) })).filter((row) => row.negativeMargin));
    return { ...response, meta: { ...response.meta, simulationAmount: 100, warnings } };
  }
}
