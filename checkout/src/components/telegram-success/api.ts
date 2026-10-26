import { SIM_API_URL, PAGATG_API_URL } from '@/lib/api-config';
import type { ApiError, InviteLinkData, PurchaseDetails } from './types';

export const API_BASE = PAGATG_API_URL;
export const SIM_API_BASE = SIM_API_URL;
// Backoff: o webhook do PagaTG precisa de um instante para gravar o registro.
// Começa curto (pega o caso rápido em ~1s) e cresce até 5s.
export const POLL_DELAYS_MS = [
  1000, 1000, 2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000,
];
export const MAX_POLL_ATTEMPTS = POLL_DELAYS_MS.length;

export function pollDelayFor(attempt: number): number {
  return POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];
}

type RawPurchaseData = {
  type: 'PIX_PLAN' | 'SUBSCRIPTION';
  plan?: { name: string; price: number; daysCredited?: number };
  subscription?: {
    plan: { description: string; value: number; frequencyType?: string };
    createdAt: string;
    customer: { email: string };
    paymentMethod?: string;
  };
  planAccess?: { isActive: boolean };
  transaction?: { createdAt: string; paymentMethod?: string };
  customer?: { email: string };
  paymentMethod?: string;
};

function resolvePaymentMethod(raw: RawPurchaseData): string {
  if (raw.type === 'PIX_PLAN') return 'PIX';

  const method =
    raw.paymentMethod ||
    raw.subscription?.paymentMethod ||
    raw.transaction?.paymentMethod ||
    (typeof window !== 'undefined'
      ? localStorage.getItem('checkout_payment_method')
      : null);

  if (!method) return 'Cartão de Crédito';

  const normalized = method.toLowerCase();
  if (normalized === 'pix') return 'PIX';
  if (
    normalized.includes('credit') ||
    normalized.includes('cartao') ||
    normalized.includes('card')
  ) {
    return 'Cartão de Crédito';
  }
  return method;
}

function normalizePurchaseData(raw: RawPurchaseData): PurchaseDetails {
  if (raw.type === 'PIX_PLAN') {
    return {
      planName: raw.plan?.name ?? null,
      planValue: raw.plan?.price ?? null,
      planFrequency: null,
      planDays: raw.plan?.daysCredited ?? null,
      isActive: raw.planAccess?.isActive ?? true,
      paymentMethod: 'PIX',
      purchaseDate: raw.transaction?.createdAt ?? null,
      customerEmail: raw.customer?.email ?? null,
    };
  }

  return {
    planName: raw.subscription?.plan?.description ?? null,
    planValue: raw.subscription?.plan?.value ?? null,
    planFrequency: raw.subscription?.plan?.frequencyType ?? null,
    planDays: null,
    isActive: true,
    paymentMethod: resolvePaymentMethod(raw),
    purchaseDate: raw.subscription?.createdAt ?? null,
    customerEmail: raw.subscription?.customer?.email ?? null,
  };
}

export async function fetchPurchaseDetails(
  reference: string,
): Promise<PurchaseDetails | null> {
  try {
    const res = await fetch(`${SIM_API_BASE}/public/purchase/${reference}`);
    if (!res.ok) return null;
    const data: RawPurchaseData = await res.json();
    return normalizePurchaseData(data);
  } catch {
    return null;
  }
}

export async function fetchInviteLink(
  planCode: string,
  email: string,
  customerId?: string | null,
  subscriptionId?: string | null,
): Promise<InviteLinkData> {
  const params = new URLSearchParams({ planCode, email });
  if (customerId) params.append('customerId', customerId);
  if (subscriptionId) params.append('subscriptionId', subscriptionId);

  const res = await fetch(
    `${API_BASE}/group-pages/public/invite-link-by-code?${params}`,
  );
  const data = await res.json();

  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message: data?.message ?? 'Erro desconhecido',
    };
    throw err;
  }

  return data as InviteLinkData;
}

export async function regenerateInviteLink(
  groupPageId: string,
  email: string,
): Promise<{ inviteLink: string }> {
  const res = await fetch(
    `${API_BASE}/group-pages/public/regenerate-invite-link`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupPageId, email }),
    },
  );
  const data = await res.json();

  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message: data?.message ?? 'Erro desconhecido',
    };
    throw err;
  }

  return data as { inviteLink: string };
}
