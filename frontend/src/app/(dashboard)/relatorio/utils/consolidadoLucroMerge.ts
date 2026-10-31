import type {
  LucroSimpayDetalhe,
  Plataforma,
} from '../components/LucroSimpayDetalhePanel';

/** Resposta do consolidado às vezes vem como `{ data: { ... } }`. */
export function unwrapConsolidadoPayload(
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const d = r.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const inner = d as Record<string, unknown>;
    if (
      'lucroTotalMaster' in inner ||
      'valorBruto' in inner ||
      'lucroSimpayDetalhe' in inner ||
      'lucroSimpay' in inner
    ) {
      return inner;
    }
  }
  return r;
}

function canonicalTag(tag: string): string {
  return tag.trim().toUpperCase();
}

function hasEbookNaLista(plats: { tag: string }[]): boolean {
  return plats.some((p) => {
    const t = canonicalTag(p.tag);
    return t === 'EBOOK' || t === 'EBOOKSIM';
  });
}

function hasAreaflixNaLista(plats: { tag: string }[]): boolean {
  return plats.some((p) => canonicalTag(p.tag) === 'AREAFLIX');
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function plataformaVaziaEbook(subtotalLucro: number): Plataforma {
  return {
    tag: 'EBOOKSIM',
    userId: '',
    envLiquidez: '',
    envTaxaFixa: '',
    envTaxaCashback: '',
    envTaxaServico: '',
    liquidezLojista: 0,
    taxaFixaTransacao: 0,
    taxaCashback: 0,
    taxaServico: 0,
    quantidadeTransacoes: 0,
    subtotalBruto: 0,
    subtotalParteAdminMaster: 0,
    subtotalDeducaoTaxaFixa: 0,
    subtotalDeducaoTaxaCashback: 0,
    subtotalDeducaoTaxaServico: 0,
    subtotalLucro,
    transacoes: [],
  };
}

function plataformaVaziaAreaflix(subtotalLucro: number): Plataforma {
  return {
    tag: 'AREAFLIX',
    userId: '',
    envLiquidez: '',
    envTaxaFixa: '',
    envTaxaCashback: '',
    envTaxaServico: '',
    liquidezLojista: 0,
    taxaFixaTransacao: 0,
    taxaCashback: 0,
    taxaServico: 0,
    quantidadeTransacoes: 0,
    subtotalBruto: 0,
    subtotalParteAdminMaster: 0,
    subtotalDeducaoTaxaFixa: 0,
    subtotalDeducaoTaxaCashback: 0,
    subtotalDeducaoTaxaServico: 0,
    subtotalLucro,
    transacoes: [],
  };
}

function isPlataformaLike(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x) && 'tag' in x);
}

function extrairPlataformasDeDetalheAninhado(v: unknown): Plataforma[] {
  if (!v || typeof v !== 'object') return [];
  const pls = (v as Record<string, unknown>).plataformas;
  if (!Array.isArray(pls)) return [];
  return pls.filter(isPlataformaLike) as Plataforma[];
}

/**
 * Inclui o lucro da plataforma Ebook no detalhe usado pelo gráfico quando o BFF
 * envia o valor fora de `plataformas` (campos numéricos ou segundo bloco de detalhe).
 */
export function mergeEbookIntoLucroSimpayDetalhe(
  detalhe: LucroSimpayDetalhe,
  consolidadoRaw: unknown,
): LucroSimpayDetalhe {
  const root = unwrapConsolidadoPayload(consolidadoRaw);
  const extraPlats: Plataforma[] = [];
  let plataformas = [...detalhe.plataformas];

  const detExt = detalhe as LucroSimpayDetalhe & Record<string, unknown>;
  for (const key of [
    'plataformaEbook',
    'ebook',
    'lucroEbookPlataforma',
  ] as const) {
    const block = detExt[key];
    if (isPlataformaLike(block)) {
      const p = { ...(block as Plataforma) };
      if (!String(p.tag ?? '').trim()) p.tag = 'EBOOKSIM';
      extraPlats.push(p);
    }
  }

  for (const key of [
    'lucroSimpayDetalheEbook',
    'lucroSimpayEbookDetalhe',
    'ebookLucroSimpayDetalhe',
  ] as const) {
    extraPlats.push(...extrairPlataformasDeDetalheAninhado(root[key]));
  }

  const porPlat = root.lucroSimpayPorPlataforma ?? root.lucroPorPlataforma;
  if (Array.isArray(porPlat)) {
    for (const row of porPlat) {
      if (!isPlataformaLike(row)) continue;
      const tag = canonicalTag(
        String((row as Record<string, unknown>).tag ?? ''),
      );
      if (tag === 'EBOOK' || tag === 'EBOOKSIM') {
        const p = { ...(row as Plataforma) };
        p.tag = 'EBOOKSIM';
        extraPlats.push(p);
      }
    }
  }

  const ebookExtras = extraPlats.filter((p) => {
    const t = canonicalTag(p.tag);
    return t === 'EBOOK' || t === 'EBOOKSIM';
  });

  if (!hasEbookNaLista(plataformas)) {
    const comTx = ebookExtras.filter((p) => (p.transacoes?.length ?? 0) > 0);
    const semTx = ebookExtras.filter((p) => (p.transacoes?.length ?? 0) === 0);
    if (comTx.length > 0) {
      plataformas = [
        ...plataformas,
        ...comTx.map((p) => ({ ...p, tag: 'EBOOKSIM' })),
      ];
    } else if (semTx.length > 0) {
      const sub = semTx.reduce((s, p) => s + asNumber(p.subtotalLucro), 0);
      if (sub > 0) plataformas = [...plataformas, plataformaVaziaEbook(sub)];
    } else {
      const lucroFromDetalhe = asNumber(
        detExt.lucroSimpayEbook ??
          detExt.lucroEbook ??
          detExt.lucroSimpayPlataformaEbook ??
          detExt.ebookLucroSimpay,
      );
      const lucroEbook =
        lucroFromDetalhe > 0
          ? lucroFromDetalhe
          : asNumber(
              root.lucroSimpayEbook ??
                root.lucroEbook ??
                root.lucroSimpayPlataformaEbook ??
                root.ebookLucroSimpay ??
                root.lucroMasterEbook,
            );
      if (lucroEbook > 0) {
        plataformas = [...plataformas, plataformaVaziaEbook(lucroEbook)];
      }
    }
  } else {
    plataformas = plataformas.map((p) => {
      const t = canonicalTag(p.tag);
      if (t === 'EBOOK') {
        return { ...p, tag: 'EBOOKSIM' };
      }
      return p;
    });
  }

  return { ...detalhe, plataformas };
}

/**
 * Mesmo padrão do Ebook: lucro Areaflix às vezes vem em campos paralelos no consolidado.
 */
export function mergeAreaflixIntoLucroSimpayDetalhe(
  detalhe: LucroSimpayDetalhe,
  consolidadoRaw: unknown,
): LucroSimpayDetalhe {
  const root = unwrapConsolidadoPayload(consolidadoRaw);
  const extraPlats: Plataforma[] = [];
  let plataformas = [...detalhe.plataformas];

  const detExt = detalhe as LucroSimpayDetalhe & Record<string, unknown>;
  for (const key of [
    'plataformaAreaflix',
    'areaflix',
    'lucroAreaflixPlataforma',
  ] as const) {
    const block = detExt[key];
    if (isPlataformaLike(block)) {
      const p = { ...(block as Plataforma) };
      if (!String(p.tag ?? '').trim()) p.tag = 'AREAFLIX';
      extraPlats.push(p);
    }
  }

  for (const key of [
    'lucroSimpayDetalheAreaflix',
    'lucroSimpayAreaflixDetalhe',
    'areaflixLucroSimpayDetalhe',
  ] as const) {
    extraPlats.push(...extrairPlataformasDeDetalheAninhado(root[key]));
  }

  const porPlat = root.lucroSimpayPorPlataforma ?? root.lucroPorPlataforma;
  if (Array.isArray(porPlat)) {
    for (const row of porPlat) {
      if (!isPlataformaLike(row)) continue;
      const tag = canonicalTag(
        String((row as Record<string, unknown>).tag ?? ''),
      );
      if (tag === 'AREAFLIX') extraPlats.push(row as Plataforma);
    }
  }

  const areaflixExtras = extraPlats.filter(
    (p) => canonicalTag(p.tag) === 'AREAFLIX',
  );

  if (!hasAreaflixNaLista(plataformas)) {
    const comTx = areaflixExtras.filter((p) => (p.transacoes?.length ?? 0) > 0);
    const semTx = areaflixExtras.filter(
      (p) => (p.transacoes?.length ?? 0) === 0,
    );
    if (comTx.length > 0) {
      plataformas = [...plataformas, ...comTx];
    } else if (semTx.length > 0) {
      const sub = semTx.reduce((s, p) => s + asNumber(p.subtotalLucro), 0);
      if (sub > 0) plataformas = [...plataformas, plataformaVaziaAreaflix(sub)];
    } else {
      const lucroFromDetalhe = asNumber(
        detExt.lucroSimpayAreaflix ??
          detExt.areaflixLucroSimpay ??
          detExt.lucroSimpayPlataformaAreaflix,
      );
      const lucroAreaflix =
        lucroFromDetalhe > 0
          ? lucroFromDetalhe
          : asNumber(
              root.lucroSimpayAreaflix ??
                root.areaflixLucroSimpay ??
                root.lucroSimpayPlataformaAreaflix ??
                root.lucroMasterAreaflix,
            );
      if (lucroAreaflix > 0) {
        plataformas = [...plataformas, plataformaVaziaAreaflix(lucroAreaflix)];
      }
    }
  }

  return { ...detalhe, plataformas };
}

/** Ebook + Areaflix: usado no relatório e no painel admin (gráfico com `detalharLucro`). */
export function applyLucroSimpayDetalheConsolidadoMerges(
  detalhe: LucroSimpayDetalhe,
  consolidadoRaw: unknown,
): LucroSimpayDetalhe {
  return mergeAreaflixIntoLucroSimpayDetalhe(
    mergeEbookIntoLucroSimpayDetalhe(detalhe, consolidadoRaw),
    consolidadoRaw,
  );
}
