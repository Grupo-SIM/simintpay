import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { syncStatus } from './platform-sync.adapter';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Provider contracts only; authentication and settlement stay in the core. */
export function platformWebhookEvent(acquirer: 'DOM' | 'FRENDZ', payload: unknown): { paymentId: string; status: string; externalReference?: string } {
  const body = object(payload);
  const data = object(acquirer === 'FRENDZ' ? body.transaction : body.data);
  if (acquirer === 'FRENDZ') {
    const event = frendzWebhookContract(payload);
    if (!event || !event.paymentId.trim()) throw new BadRequestException({ code: 'INVALID_WEBHOOK_EVENT' });
    const reference = data.cod_external ?? body.cod_external;
    return { ...event, ...(typeof reference === 'string' && /^[a-f0-9]{64}$/.test(reference) ? { externalReference: reference } : {}) };
  }
  const id = data.paymentId ?? data.order_id ?? data.id;
  const rawStatus = String(data.status ?? '').toLowerCase();
  const mapped = syncStatus(rawStatus);
  const status = mapped === 'COMPLETED' ? 'paid' : mapped === 'FAILED' ? 'failed' : mapped?.toLowerCase() ?? (['in_mediation', 'pending_refund'].includes(rawStatus) ? rawStatus : null);
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim() || !status) throw new BadRequestException({ code: 'INVALID_WEBHOOK_EVENT' });
  const reference = data.cod_external ?? body.cod_external;
  return { paymentId: String(id), status, ...(typeof reference === 'string' && /^[a-f0-9]{64}$/.test(reference) ? { externalReference: reference } : {}) };
}

function frendzString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}
function frendzStatus(value: unknown): string | null {
  const status = frendzString(value)?.toLowerCase();
  if (['paid', 'refunded', 'chargeback', 'pending'].includes(status ?? '')) return status!;
  if (['in_protest', 'in_mediation', 'in_dispute'].includes(status ?? '')) return 'in_mediation';
  if (status === 'waiting_payment') return 'pending';
  if (['canceled', 'cancelled', 'refused', 'failed'].includes(status ?? '')) return 'failed';
  return null;
}
export function frendzWebhookContract(payload: unknown) {
  const body = object(payload), tx = object(body.transaction);
  const paymentId = frendzString(tx.id) ?? frendzString(body.id) ?? frendzString(tx.hash);
  const status = frendzStatus(body.status) ?? frendzStatus(tx.status);
  return paymentId && status ? { paymentId, status } : null;
}
/** Legacy transport envelope only; settlement still uses stored financial snapshots. */
export function legacyFrendzWebhookPayload(payload: unknown) {
  const event = frendzWebhookContract(payload);
  if (!event) return null;
  const body = object(payload), tx = object(body.transaction);
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const cents = number(tx.net_amount) ?? number(tx.amount) ?? 0;
  return { event: frendzString(body.event) ?? 'transaction', signature: createHash('sha256').update(`frendz:${event.paymentId}:${event.status}`).digest('hex'),
    data: { ...event, amountWithoutAllFee: Number((cents / 100).toFixed(2)), acquirer: 'FRENDZ', method: frendzString(body.method) ?? 'pix', paidAt: frendzString(body.paid_at), refundedAt: frendzString(body.refunded_at) } };
}
