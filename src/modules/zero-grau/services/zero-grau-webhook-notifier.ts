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
    secret: process.env.ZERO_GRAU_WEBHOOK_SECRET,
    url: process.env.ZERO_GRAU_WEBHOOK_URL,
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
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
