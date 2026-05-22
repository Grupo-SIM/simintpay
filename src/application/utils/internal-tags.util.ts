export const TENANT_RENOVADA_TAG = '[TENANT:RENOVADA]';
export const TENANT_BOSQUE_TAG = '[TENANT:BOSQUE]';
export const TENANT_EBOOK_TAG = '[TENANT:EBOOK]';
/** Links de assinatura com webhook Areaflix — entram no consolidado / relatórios. */
export const TENANT_AREAFLIX_TAG = '[TENANT:AREAFLIX]';
export const TENANT_CONTROLE_MOTORISTA_TAG = '[TENANT:CONTROLE-MOTORISTA]';
export const TENANT_CONTROLE_PATRIMONIAL_TAG = '[TENANT:CONTROLE-PATRIMONIAL]';
export const ORIGEM_MAQUINETA_TAG = '[ORIGEM:MAQUINETA]';

const INTERNAL_TAGS = [
  TENANT_RENOVADA_TAG,
  TENANT_BOSQUE_TAG,
  TENANT_EBOOK_TAG,
  TENANT_AREAFLIX_TAG,
  TENANT_CONTROLE_MOTORISTA_TAG,
  TENANT_CONTROLE_PATRIMONIAL_TAG,
  ORIGEM_MAQUINETA_TAG,
];

export function appendInternalTags(
  value: string | null | undefined,
  tags: string[],
  fallbackBase?: string,
): string {
  const uniqueTags = [...new Set(tags.filter(Boolean))];
  let out = (value ?? '').trim();
  if (!out) out = (fallbackBase ?? '').trim();
  for (const tag of uniqueTags) {
    if (!out.includes(tag)) {
      out = out ? `${out} ${tag}` : tag;
    }
  }
  return out.trim();
}

export function stripInternalTags(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = INTERNAL_TAGS.reduce((acc, tag) => acc.replaceAll(tag, ''), value)
    .replace(/\s*\[CPF_DONO:[^\]]+\]/gi, '')
    .replace(/\s*\[NOME_DONO:[^\]]+\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

