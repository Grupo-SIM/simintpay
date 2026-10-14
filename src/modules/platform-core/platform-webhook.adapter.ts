import { BadRequestException } from '@nestjs/common';
import { syncStatus } from './platform-sync.adapter';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Provider contracts only; authentication and settlement stay in the core. */
export function platformWebhookEvent(acquirer: 'DOM' | 'FRENDZ', payload: unknown): { paymentId: string; status: string; externalReference?: string } {
  const body = object(payload);
  const data = object(acquirer === 'FRENDZ' ? body.transaction : body.data);
  const id = acquirer === 'FRENDZ' ? data.id ?? body.id ?? data.hash : data.paymentId ?? data.order_id ?? data.id;
  const rawStatus = String((acquirer === 'FRENDZ' ? body.status : undefined) ?? data.status ?? '').toLowerCase();
  const mapped = syncStatus(rawStatus);
  const status = mapped === 'COMPLETED' ? 'paid' : mapped === 'FAILED' ? 'failed' : mapped?.toLowerCase() ?? (['in_mediation', 'pending_refund'].includes(rawStatus) ? rawStatus : null);
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim() || !status) throw new BadRequestException({ code: 'INVALID_WEBHOOK_EVENT' });
  const reference = data.cod_external ?? body.cod_external;
  return { paymentId: String(id), status, ...(typeof reference === 'string' && /^[a-f0-9]{64}$/.test(reference) ? { externalReference: reference } : {}) };
}
