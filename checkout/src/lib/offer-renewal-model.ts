/**
 * Lógica pura da renovação pública de assinatura (`?ofertaCode=&renovar=&sig=`), link enviado
 * pelos avisos por e-mail. A assinatura (`sig`) nunca é exibida nem registrada em log.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

type Params = { get(name: string): string | null };

export type RenewalLink = { contractId: string; sig: string };

/** Lê `renovar` (uuid do contrato) e `sig` (HMAC SHA-256 hex); `null` se ausentes ou malformados. */
export function parseRenewalParams(params: Params): RenewalLink | null {
  const contractId = params.get('renovar')?.trim() ?? '';
  const sig = params.get('sig')?.trim() ?? '';
  if (!UUID.test(contractId) || !HEX_SHA256.test(sig)) return null;
  return { contractId: contractId.toLowerCase(), sig: sig.toLowerCase() };
}

export const isRenewalRequest = (params: Params) =>
  Boolean(params.get('renovar'));

export function renewalBody(link: RenewalLink) {
  return { contractId: link.contractId, sig: link.sig, paymentMethod: 'pix' };
}

export type RenewalKind = 'CYCLE' | 'REACTIVATION';

export type RenewalResponse = {
  transactionId?: string;
  kind?: RenewalKind;
  existing?: boolean;
  amount?: number;
  pix?: {
    pixContent?: string | null;
    qrCode?: string | null;
    pixExpire?: string | null;
  };
};

export type RenewalPix = {
  kind: RenewalKind;
  existing: boolean;
  amount: number | null;
  transactionId: string;
  pixContent: string | null;
  qrCode: string | null;
  pixExpire: string | null;
};

/** Resposta 201 -> dados do PIX; `null` se a API não devolveu transação nem PIX utilizável. */
export function mapRenewalResponse(data: RenewalResponse): RenewalPix | null {
  const transactionId = data.transactionId;
  const pixContent = data.pix?.pixContent ?? null;
  const qrCode = data.pix?.qrCode ?? null;
  if (!transactionId || (!pixContent && !qrCode)) return null;
  return {
    kind: data.kind === 'REACTIVATION' ? 'REACTIVATION' : 'CYCLE',
    existing: Boolean(data.existing),
    amount: typeof data.amount === 'number' ? data.amount : null,
    transactionId,
    pixContent,
    qrCode,
    pixExpire: data.pix?.pixExpire ?? null,
  };
}

export const INVALID_LINK_MESSAGE =
  'Este link é inválido ou expirou. Peça um novo aviso ao suporte.';
export const UP_TO_DATE_MESSAGE = 'Sua assinatura já está em dia.';

export type RenewalFailure = {
  kind: 'invalid' | 'upToDate' | 'error';
  title: string;
  message: string;
  /** Permite tentar de novo na mesma tela (falha temporária). */
  retryable: boolean;
};

/** Erros do `POST /ofertas/public/:code/renew`. 403 nunca revela o motivo. */
export function mapRenewalError(
  status: number,
  data?: { message?: unknown },
): RenewalFailure {
  const message = typeof data?.message === 'string' ? data.message.trim() : '';
  if (status === 403)
    return {
      kind: 'invalid',
      title: 'Link inválido',
      message: INVALID_LINK_MESSAGE,
      retryable: false,
    };
  if (status === 409 && /em dia/i.test(message))
    return {
      kind: 'upToDate',
      title: 'Tudo certo',
      message: UP_TO_DATE_MESSAGE,
      retryable: false,
    };
  if (status === 404)
    return {
      kind: 'error',
      title: 'Assinatura não encontrada',
      message: message || 'Assinatura não encontrada.',
      retryable: false,
    };
  if (status === 409)
    return {
      kind: 'error',
      title: 'Não foi possível renovar',
      message: message || 'Não foi possível renovar agora. Fale com o suporte.',
      retryable: false,
    };
  return {
    kind: 'error',
    title: 'Não foi possível gerar o PIX',
    message: 'Erro ao gerar o PIX de renovação. Tente novamente.',
    retryable: true,
  };
}

/** Título neutro antes do POST (ainda não se sabe se é renovação ou reativação). */
export function renewalTitle(kind: RenewalKind | null): string {
  return kind === 'REACTIVATION' ? 'Reativar assinatura' : 'Renovar assinatura';
}

export const RENEWAL_BUTTON_LABEL = 'Gerar PIX para renovar';

function parseExpire(expire: string | null): number | null {
  if (!expire) return null;
  const trimmed = expire.trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** PIX vencido: data interpretável e já passada. Sem data válida, nunca considera vencido. */
export function isPixExpired(expire: string | null, now = Date.now()): boolean {
  const target = parseExpire(expire);
  return target !== null && target <= now;
}
