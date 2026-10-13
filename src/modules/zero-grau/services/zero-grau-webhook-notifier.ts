import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
export interface ZeroGrauPaymentStatusWebhook {
  paymentId: string;
  status: string;
}

export type ZeroGrauWebhookResult = 'failed' | 'sent' | 'skipped';

interface ZeroGrauWebhookConfig {
  secret?: string;
  url?: string;
}

export async function notifyZeroGrauPaymentStatus(
  payload: ZeroGrauPaymentStatusWebhook,
  config: ZeroGrauWebhookConfig = {
    secret: (getPlatformIntegrationValue('ZERO-GRAU', 'WEBHOOK_SECRET') ?? undefined),
    url: (getPlatformIntegrationValue('ZERO-GRAU', 'WEBHOOK_URL') ?? undefined),
  },
  fetcher: typeof fetch = fetch,
): Promise<ZeroGrauWebhookResult> {
  const secret = config.secret?.trim();
  const url = config.url?.trim();
  if (!secret || !url) return 'skipped';

  try {
    const response = await fetcher(url, {
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        'x-simpay-webhook-secret': secret,
      },
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
