import { getDefaultApiBaseUrl } from '@/services/api/api.client';

/**
 * URL absoluta para exibir/baixar comprovante.
 * O backend costuma gravar URL pública (ex. Storj); se vier path relativo, prefixa a API.
 */
export function resolveComprovanteUrl(raw: string | null | undefined): string {
  if (raw == null) return '';
  const u = String(raw).trim();
  if (!u) return '';
  if (/^blob:/i.test(u) || /^data:/i.test(u)) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  try {
    const base = getDefaultApiBaseUrl().replace(/\/$/, '');
    if (u.startsWith('/')) return `${base}${u}`;
    return `${base}/${u}`;
  } catch {
    return u;
  }
}

export function isComprovantePdfUrl(url: string): boolean {
  try {
    const path = url.split('?')[0]?.split('#')[0] ?? url;
    return path.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().includes('.pdf');
  }
}
