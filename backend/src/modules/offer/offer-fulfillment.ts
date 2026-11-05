import { isIP } from 'node:net';

/**
 * Contrato de `Offer.fulfillment` (JSON): o que a oferta entrega depois de paga.
 * Espelha o que o link de pagamento legado entrega (arquivos por e-mail, mensagem, webhook,
 * redirect) e liga order bumps / upsell / downsell a outras ofertas do mesmo titular.
 */
export const FULFILLMENT_ROLES = ['BUMP', 'UPSELL', 'DOWNSELL'] as const;
export type FulfillmentRole = (typeof FULFILLMENT_ROLES)[number];

/** Mesmos limites do link legado (payment-link-offers.helper). */
export const MAX_FULFILLMENT_BUMPS = 5;
export const MAX_FULFILLMENT_FILES = 10;

/** Itens vendidos numa Charge, gravados em `Charge.snapshot.items` no checkout. */
export type ChargeItem = {
  role: 'MAIN' | FulfillmentRole;
  offerId: string;
  title: string;
  amountCents: number;
};

export type FulfillmentFile = {
  fileName: string;
  /** URL do storage privado (só o host do STORJ_ENDPOINT é baixado). */
  fileUrl: string;
};

export type FulfillmentBump = { offerId: string; role: FulfillmentRole };

export type OfferFulfillment = {
  files: FulfillmentFile[];
  emailBody: string | null;
  webhookUrl: string | null;
  redirectUrl: string | null;
  /** Reservado: vínculo com comunidade. Validado como texto e ignorado por enquanto. */
  communityId: string | null;
  bumps: FulfillmentBump[];
};

export class OfferFulfillmentError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('; '));
    this.name = 'OfferFulfillmentError';
  }
}

const KEYS = new Set([
  'files',
  'emailBody',
  'webhookUrl',
  'redirectUrl',
  'communityId',
  'bumps',
]);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : null);

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** true quando o IP literal aponta para rede interna/loopback/link-local/metadata. */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(host);
  if (family === 4) return isPrivateIPv4(host);
  if (family === 6) {
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    // O parser de URL normaliza ::ffff:a.b.c.d para ::ffff:hhhh:hhhh.
    const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/.test(host)
    );
  }
  return false;
}

/**
 * Checagem estática (sem DNS) de uma URL de webhook/redirect: http(s), sem credenciais,
 * sem host interno nem IP privado literal. A resolução de DNS é checada no envio.
 */
export function unsafeUrlReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'URL inválida';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return 'Use uma URL http(s)';
  if (url.username || url.password) return 'A URL não pode conter credenciais';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain') ||
    (!host.includes('.') && isIP(host.replace(/^\[|\]$/g, '')) === 0)
  )
    return 'Host não permitido';
  if (isPrivateAddress(host)) return 'Endereço de rede interna não permitido';
  return null;
}

/**
 * Valida e normaliza o JSON de entrega. Pura. `null`/`undefined` viram uma entrega vazia.
 * Não consulta o banco: a referência dos bumps (mesmo titular, ativa) é checada pelo serviço.
 */
export function parseOfferFulfillment(raw: unknown): OfferFulfillment {
  const empty: OfferFulfillment = {
    files: [],
    emailBody: null,
    webhookUrl: null,
    redirectUrl: null,
    communityId: null,
    bumps: [],
  };
  if (raw === null || raw === undefined) return empty;
  const issues: string[] = [];
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new OfferFulfillmentError(['fulfillment deve ser um objeto']);
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (!KEYS.has(key))
      issues.push(`Campo desconhecido em fulfillment: ${key}`);

  const files: FulfillmentFile[] = [];
  if (input.files !== undefined && input.files !== null) {
    if (!Array.isArray(input.files)) issues.push('files deve ser uma lista');
    else {
      if (input.files.length > MAX_FULFILLMENT_FILES)
        issues.push(`Máximo de ${MAX_FULFILLMENT_FILES} arquivos`);
      for (const f of input.files as Record<string, unknown>[]) {
        const fileName = str(f?.fileName);
        const fileUrl = str(f?.fileUrl);
        if (!fileName || !fileUrl || !/^https?:\/\//i.test(fileUrl))
          issues.push('Arquivo precisa de fileName e fileUrl (http/https)');
        else files.push({ fileName, fileUrl });
      }
    }
  }

  const optionalText = (key: string, max: number) => {
    const v = input[key];
    if (v === undefined || v === null || v === '') return null;
    const s = str(v);
    if (s === null || s.length > max) {
      issues.push(`${key} deve ser um texto de até ${max} caracteres`);
      return null;
    }
    return s || null;
  };
  const optionalUrl = (key: 'webhookUrl' | 'redirectUrl') => {
    const s = optionalText(key, 2048);
    if (!s) return null;
    const reason = unsafeUrlReason(s);
    if (reason) {
      issues.push(`${key}: ${reason}`);
      return null;
    }
    return s;
  };

  const emailBody = optionalText('emailBody', 20_000);
  const webhookUrl = optionalUrl('webhookUrl');
  const redirectUrl = optionalUrl('redirectUrl');
  const communityId = optionalText('communityId', 200);

  const bumps: FulfillmentBump[] = [];
  if (input.bumps !== undefined && input.bumps !== null) {
    if (!Array.isArray(input.bumps)) issues.push('bumps deve ser uma lista');
    else {
      for (const b of input.bumps as Record<string, unknown>[]) {
        const offerId = str(b?.offerId);
        const role = b?.role;
        if (!offerId || !FULFILLMENT_ROLES.includes(role as FulfillmentRole))
          issues.push(
            'Bump precisa de offerId e role (BUMP, UPSELL ou DOWNSELL)',
          );
        else bumps.push({ offerId, role: role as FulfillmentRole });
      }
      if (new Set(bumps.map((b) => b.offerId)).size !== bumps.length)
        issues.push('Oferta repetida em bumps');
      const count = (r: FulfillmentRole) =>
        bumps.filter((b) => b.role === r).length;
      if (count('BUMP') > MAX_FULFILLMENT_BUMPS)
        issues.push(`Máximo de ${MAX_FULFILLMENT_BUMPS} order bumps`);
      if (count('UPSELL') > 1) issues.push('Apenas 1 upsell por oferta');
      if (count('DOWNSELL') > 1) issues.push('Apenas 1 downsell por oferta');
      if (count('DOWNSELL') > 0 && count('UPSELL') === 0)
        issues.push('Downsell exige um upsell configurado');
    }
  }

  if (issues.length) throw new OfferFulfillmentError(issues);
  return { files, emailBody, webhookUrl, redirectUrl, communityId, bumps };
}

/** Leitura tolerante para o checkout/entrega: JSON inválido já gravado vira entrega vazia. */
export function readOfferFulfillment(raw: unknown): OfferFulfillment {
  try {
    return parseOfferFulfillment(raw);
  } catch {
    return parseOfferFulfillment(null);
  }
}
