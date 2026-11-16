import { Injectable, Logger } from '@nestjs/common';
import { unsafeUrlReason } from '../offer/offer-fulfillment';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

export type PagatgCreditStatus = 'COMPLETED' | 'ACTIVE' | 'SUSPENDED';

/** Corpo de `POST {PAGATG.BACKEND_URL}/webhook/pix-credit` (idêntico ao do plano PIX legado). */
export type PagatgCreditPayload = {
  code: string;
  email: string;
  customerId: string | null;
  status: PagatgCreditStatus;
  userId: string;
};

export type PagatgFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number }>;

/** Corpo de `POST {PAGATG.BACKEND_URL}/webhook/signature` (idêntico ao da pausa/retomada legada). */
export type PagatgSignaturePayload = {
  type: 'SIGNATURE-PAUSED' | 'SIGNATURE-RESUMED';
  data: {
    customer: {
      id: string | null;
      name: string | null;
      email: string | null;
      document?: string | null;
    };
    plan: { id: string | null; description: string | null };
    subscription: { id: string; status: 'PAUSED' | 'ACTIVE' };
  };
};

const TIMEOUT_MS = 10_000;

/**
 * Notifica o api-pagatg sobre mudanças do crédito de dias. Mesma origem de configuração, mesmo
 * cabeçalho (`x-pagatg-internal-token`) e mesmo corpo do legado (que não assina nem tenta de
 * novo). Acrescenta apenas: URL validada contra SSRF (http/https, sem IP interno) e timeout.
 * Nunca lança: uma falha aqui não pode desfazer a liquidação nem a mudança de estado.
 */
@Injectable()
export class PagatgNotifier {
  private readonly logger = new Logger(PagatgNotifier.name);
  fetchImpl: PagatgFetch = (url, init) => fetch(url, init);

  async notify(payload: PagatgCreditPayload): Promise<boolean> {
    return this.post('/webhook/pix-credit', payload, payload.status);
  }

  /** `POST {PAGATG.BACKEND_URL}/webhook/signature`: pausa/retomada de assinatura (corpo do legado). */
  async notifySignature(payload: PagatgSignaturePayload): Promise<boolean> {
    return this.post('/webhook/signature', payload, payload.type);
  }

  private async post(
    path: string,
    payload: object,
    label: string,
  ): Promise<boolean> {
    try {
      const base = (
        (getPlatformIntegrationValue('PAGATG', 'BACKEND_URL') ?? undefined) ||
        ''
      ).replace(/\/+$/, '');
      if (!base) return false;
      const url = `${base}${path}`;
      const unsafe = unsafeUrlReason(url);
      if (unsafe) {
        this.logger.error(`[PagatgNotifier] URL recusada (${unsafe})`);
        return false;
      }
      const token =
        (getPlatformIntegrationValue('PAGATG', 'INTERNAL_TOKEN') ??
          undefined) ||
        '';
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-pagatg-internal-token': token } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok)
        this.logger.error(
          `[PagatgNotifier] api-pagatg respondeu ${res.status} (${label})`,
        );
      return res.ok;
    } catch (error) {
      this.logger.error(
        `[PagatgNotifier] Erro ao notificar api-pagatg (${label}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
