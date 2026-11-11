import type {
  LucroSimpayDetalhe,
  SaqueDiarioItem,
} from '../components/LucroSimpayDetalhePanel';

export function saqueSerieTag(platformTag: string): string {
  return `${canonicalPlataformaTag(platformTag)}_SAQUE`;
}

const SP_TZ = 'America/Sao_Paulo';

/** Data da transação no fuso de São Paulo (alinhado ao consolidado do backend). */
export function toDateKeySaoPaulo(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function enumerateYmdInRange(ymdStart: string, ymdEnd: string): string[] {
  const start = parseYmdLocal(ymdStart);
  const end = parseYmdLocal(ymdEnd);
  const keys: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    keys.push(formatYmdLocal(d));
  }
  return keys;
}

export type LucroPlataformaDailyRow = {
  dateKey: string;
  label: string;
} & Record<string, number | string>;

/** Agrupa séries por tag em maiúsculas (ex.: ebook + EBOOK → mesma barra). */
export function canonicalPlataformaTag(tag: string): string {
  return tag.trim().toUpperCase();
}

/**
 * Transações da plataforma Ebook costumam vir agrupadas sob outra tag (ex.: RENOVADA),
 * com o tenant real na descrição — mesmo padrão de `[TENANT:RENOVADA]`.
 */
function descricaoIndicaLucroEbook(
  descricao: string | null | undefined,
): boolean {
  if (!descricao) return false;
  return (
    /\[\s*TENANT\s*:\s*EBOOK(SIM)?\s*\]/i.test(descricao) ||
    /\[\s*ORIGEM\s*:\s*EBOOK(SIM)?\s*\]/i.test(descricao) ||
    /\[\s*PRODUTO\s*:\s*EBOOK(SIM)?\s*\]/i.test(descricao) ||
    /\[\s*MODULO\s*:\s*EBOOK(SIM)?\s*\]/i.test(descricao)
  );
}

function descricaoIndicaLucroBosque(
  descricao: string | null | undefined,
): boolean {
  if (!descricao) return false;
  if (/\[\s*TENANT\s*:\s*BOSQUE\s*\]/i.test(descricao)) return true;
  return descricao.toLowerCase().includes('bosque');
}

function descricaoIndicaLucroAreaflix(
  descricao: string | null | undefined,
): boolean {
  if (!descricao) return false;
  return (
    /\[\s*TENANT\s*:\s*AREAFLIX\s*\]/i.test(descricao) ||
    /\[\s*ORIGEM\s*:\s*AREAFLIX\s*\]/i.test(descricao) ||
    /\[\s*MODULO\s*:\s*AREAFLIX\s*\]/i.test(descricao) ||
    /\[\s*PLATAFORMA\s*:\s*AREAFLIX\s*\]/i.test(descricao) ||
    /\bareaflix\b/i.test(descricao)
  );
}

/** Série do gráfico: descrição pode realocar para BOSQUE, EBOOK ou AREAFLIX. */
function serieTagParaTransacao(
  plataformaTag: string,
  descricao: string | null | undefined,
): string {
  if (descricaoIndicaLucroBosque(descricao)) return 'BOSQUE';
  if (descricaoIndicaLucroEbook(descricao)) return 'EBOOKSIM';
  if (descricaoIndicaLucroAreaflix(descricao)) return 'AREAFLIX';
  const canonical = canonicalPlataformaTag(plataformaTag);
  if (canonical === 'EBOOK') return 'EBOOKSIM';
  return canonical;
}

export function buildLucroDiarioPorPlataformaRows(
  detalhe: LucroSimpayDetalhe,
  ymdStart: string,
  ymdEnd: string,
): { rows: LucroPlataformaDailyRow[]; tags: string[] } {
  const tagsSet = new Set(
    detalhe.plataformas
      .map((p) => canonicalPlataformaTag(p.tag))
      .filter(Boolean),
  );

  if (tagsSet.size === 0 && !detalhe.saquesPorDia?.length) {
    return { rows: [], tags: [] };
  }

  const dateKeys = enumerateYmdInRange(ymdStart, ymdEnd);
  const byDay = new Map<string, Map<string, number>>();

  for (const p of detalhe.plataformas) {
    const tag = canonicalPlataformaTag(p.tag);
    if (!tag) continue;

    const txs = p.transacoes ?? [];
    if (txs.length > 0) {
      for (const t of txs) {
        const seriesTag = serieTagParaTransacao(p.tag, t.descricao);
        tagsSet.add(seriesTag);
        const dk = toDateKeySaoPaulo(t.createdAt);
        if (!byDay.has(dk)) byDay.set(dk, new Map());
        const m = byDay.get(dk)!;
        const prev = m.get(seriesTag) ?? 0;
        m.set(seriesTag, Number((prev + t.lucroTransacao).toFixed(4)));
      }
    } else {
      const sub = Number(p.subtotalLucro ?? 0);
      const n = dateKeys.length;
      if (sub > 0 && n > 0) {
        const rawPer = sub / n;
        let acc = 0;
        for (let i = 0; i < n; i++) {
          const dk = dateKeys[i]!;
          const chunk =
            i === n - 1
              ? Number((sub - acc).toFixed(4))
              : Number(rawPer.toFixed(4));
          acc += chunk;
          if (!byDay.has(dk)) byDay.set(dk, new Map());
          const m = byDay.get(dk)!;
          const prev = m.get(tag) ?? 0;
          m.set(tag, Number((prev + chunk).toFixed(4)));
        }
      }
    }
  }

  // Adiciona lucro de saque por plataforma como séries {TAG}_SAQUE
  for (const s of detalhe.saquesPorDia ?? []) {
    const serieTag = saqueSerieTag(s.platformTag);
    tagsSet.add(serieTag);
    const dk = s.ymd;
    if (!byDay.has(dk)) byDay.set(dk, new Map());
    const m = byDay.get(dk)!;
    m.set(serieTag, Number(((m.get(serieTag) ?? 0) + s.lucroSaque).toFixed(4)));
  }

  const tags = [...tagsSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const rows: LucroPlataformaDailyRow[] = [];

  for (const dateKey of dateKeys) {
    const [y, mo, da] = dateKey.split('-').map(Number);
    const label = new Date(y, mo - 1, da).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
    const row: LucroPlataformaDailyRow = { dateKey, label };
    const dayMap = byDay.get(dateKey);
    for (const tag of tags) {
      const v = dayMap?.get(tag) ?? 0;
      row[tag] = Number(v.toFixed(2));
    }
    rows.push(row);
  }

  return { rows, tags };
}

/** Rótulos estáveis para tags sem acento vindas da API. */
const TAG_LABEL_PT: Record<string, string> = {
  EBOOK: 'EbookSim',
  EBOOKSIM: 'EbookSim',
  AREAFLIX: 'Áreaflix',
  RENOVACAO: 'Renovação',
  RESCISAO: 'Rescisão',
};

export function tagLabel(tag: string): string {
  if (!tag) return tag;
  const k = canonicalPlataformaTag(tag);
  // Séries de saque: ex. RENOVADA_SAQUE → "Renovada (Saque)"
  if (k.endsWith('_SAQUE')) {
    const base = k.slice(0, -6);
    const baseLabel =
      TAG_LABEL_PT[base] ?? base.charAt(0) + base.slice(1).toLowerCase();
    return `${baseLabel} (Saque)`;
  }
  if (TAG_LABEL_PT[k]) return TAG_LABEL_PT[k];
  return tag
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Cores por plataforma (alinhadas a `plataformas/produtos` e nomes do consolidado). */
const PLATAFORMA_CORES: Record<string, string> = {
  RENOVADA: '#d97706',
  BOSQUE: '#15803d',
  PAGATG: '#7c3aed',
  REVALIDA: '#0284c7',
  SIMPAY: '#059669',
  EBOOK: '#0891b2',
  EBOOKSIM: '#0891b2',
  AREAFLIX: '#db2777',
  ATLAS: '#0d9488',
  CLIENTE: '#64748b',
  /** Tipos de assinatura / linha (consolidado admin). */
  SISTEMA: '#16a34a',
  PACOTE: '#9333ea',
  RENOVACAO: '#d97706',
  RESCISAO: '#0284c7',
};

export function corGraficoPlataforma(tag: string): string {
  const k = tag.trim().toUpperCase();
  if (PLATAFORMA_CORES[k]) return PLATAFORMA_CORES[k];
  // Séries de saque: usa cor base da plataforma com strip pattern (opacidade 80%)
  if (k.endsWith('_SAQUE')) {
    const base = k.slice(0, -6);
    const baseColor = PLATAFORMA_CORES[base];
    if (baseColor) return baseColor + 'cc'; // hex com alpha ~80%
    // fallback: mesma lógica mas deslocando hue
    let h = 0;
    for (let i = 0; i < base.length; i++)
      h = (h + base.charCodeAt(i) * (i + 1)) % 360;
    return `hsl(${h} 70% 38%)`;
  }
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h + k.charCodeAt(i) * (i + 1)) % 360;
  return `hsl(${h} 58% 50%)`;
}

function lightenHex(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const r = Math.min(
    255,
    Math.round(parseInt(m[1], 16) + (255 - parseInt(m[1], 16)) * t),
  );
  const g = Math.min(
    255,
    Math.round(parseInt(m[2], 16) + (255 - parseInt(m[2], 16)) * t),
  );
  const b = Math.min(
    255,
    Math.round(parseInt(m[3], 16) + (255 - parseInt(m[3], 16)) * t),
  );
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Topo mais claro → base na cor da marca (para gradiente SVG nas barras). */
export function gradienteBarraPlataforma(tag: string): {
  topo: string;
  base: string;
} {
  const k = tag.trim().toUpperCase();
  const baseKey = k.endsWith('_SAQUE') ? k.slice(0, -6) : k;
  const hex = PLATAFORMA_CORES[baseKey] ?? PLATAFORMA_CORES[k];
  if (hex) {
    return { topo: lightenHex(hex, 0.42), base: hex };
  }
  const c = corGraficoPlataforma(tag);
  const m = /^hsl\(\s*(\d+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(c.trim());
  if (m) {
    const h = m[1];
    const s = m[2];
    const l = Math.min(72, parseFloat(m[3]) + 14);
    return { topo: `hsl(${h} ${s}% ${l}%)`, base: c };
  }
  return { topo: c, base: c };
}

export function idGradientePlataforma(uid: string, tag: string): string {
  const safe = tag.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${uid}_bar_${safe}`;
}
