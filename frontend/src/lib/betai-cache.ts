// Shared Betai data layer — cache + fetch used by both the dashboard panel and the report panel.
// Module-level variable lives in browser memory for the lifetime of the page session.

export const BETAI_BASE = '/api/betai';
export const BETAI_TOKEN_KEY = 'investbet_token';
export const BETAI_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

// ── Types ──────────────────────────────────────────────────────────────────────

export type BetaiUser = {
  id: string;
  name: string;
  email: string;
  balance: number;
  investedAmount: number;
  role: string;
  createdAt?: string;
};

export type BetaiAllocation = {
  userId?: string;
  sharePercent: number;
  amount: number;
  grossAmount?: number | null;
  houseAmount?: number | null;
  affiliateAmount?: number | null;
};

export type BetaiOperation = {
  id: string;
  date: string;
  event: string;
  result: 'GREEN' | 'RED' | 'VOID' | 'PENDING';
  profit: number;
  allocations?: BetaiAllocation[];
};

export type BetaiTransaction = {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  date: string;
  bankDetails?: string;
  adminNote?: string;
  user?: { id: string; name: string; email: string };
};

export type BetaiData = {
  users: BetaiUser[];
  operations: BetaiOperation[];
  transactions: BetaiTransaction[];
  withdrawalFee: number;
};

// ── Token helpers ──────────────────────────────────────────────────────────────

export function getBetaiToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(BETAI_TOKEN_KEY);
}
export function saveBetaiToken(t: string) {
  localStorage.setItem(BETAI_TOKEN_KEY, t);
}
export function clearBetaiToken() {
  localStorage.removeItem(BETAI_TOKEN_KEY);
}

// ── Shared cache ───────────────────────────────────────────────────────────────

let cache: { data: BetaiData; ts: number } | null = null;

export function getBetaiCache(): BetaiData | null {
  if (cache && Date.now() - cache.ts < BETAI_CACHE_TTL_MS) return cache.data;
  return null;
}

export function setBetaiCache(data: BetaiData) {
  cache = { data, ts: Date.now() };
}

export function invalidateBetaiCache() {
  cache = null;
}

// ── Fetch helper ───────────────────────────────────────────────────────────────

export async function betaiReq<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BETAI_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401)
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Full data fetch (with cache) ───────────────────────────────────────────────

export async function fetchBetaiData(
  token: string,
  force = false,
): Promise<BetaiData> {
  if (!force) {
    const cached = getBetaiCache();
    if (cached) return cached;
  }

  type SettingItem = { key: string; value: string };

  const [usersResp, opsResp, txResp, settingsResp] = await Promise.all([
    betaiReq<{ users: BetaiUser[] }>('/users', token),
    betaiReq<{ operations: BetaiOperation[] }>('/operations', token),
    betaiReq<{ transactions: BetaiTransaction[] } | BetaiTransaction[]>(
      '/transactions',
      token,
    ),
    betaiReq<SettingItem[] | { settings: SettingItem[] }>(
      '/settings',
      token,
    ).catch(() => [] as SettingItem[]),
  ]);

  const txList = Array.isArray(txResp)
    ? txResp
    : ((txResp as { transactions: BetaiTransaction[] }).transactions ?? []);

  const settingsList = Array.isArray(settingsResp)
    ? settingsResp
    : ((settingsResp as { settings: SettingItem[] }).settings ?? []);

  const data: BetaiData = {
    users: usersResp.users ?? [],
    operations: opsResp.operations ?? [],
    transactions: txList,
    withdrawalFee:
      Number(
        settingsList.find((s) => s.key === 'WITHDRAWAL_FEE')?.value ?? 0,
      ) || 0,
  };

  setBetaiCache(data);
  return data;
}
