const ACCESS_TOKEN_KEY = 'access_token';
const COOKIE_NAME = 'access_token';
const IMPERSONATOR_TOKEN_KEY = 'impersonator_access_token';
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Remove o token de acesso do localStorage e do cookie.
 * Use ao fazer logout ou quando o cookie tiver expirado/sido removido.
 */
export function clearAccessToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(IMPERSONATOR_TOKEN_KEY);
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Verifica se existe token no cookie (fonte de verdade para sessão).
 */
export function hasAccessTokenCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return /(?:^|;\s*)access_token=([^;]+)/.test(document.cookie);
}

/** Grava o token de acesso no localStorage e no cookie (mesma regra do login). */
export function storeAccessToken(token: string, maxAge: number): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  document.cookie = `${COOKIE_NAME}=${token}; path=/; max-age=${maxAge}; samesite=lax`;
}

/**
 * "Acessar como": guarda o token do admin (só na primeira troca, para não
 * sobrescrever com um token de usuário) e passa a usar o token do usuário.
 */
export function startImpersonation(token: string, maxAge: number): void {
  if (!localStorage.getItem(IMPERSONATOR_TOKEN_KEY)) {
    const adminToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (adminToken) localStorage.setItem(IMPERSONATOR_TOKEN_KEY, adminToken);
  }
  storeAccessToken(token, maxAge);
}

export function isImpersonating(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(IMPERSONATOR_TOKEN_KEY) !== null;
}

/** Volta para a sessão do admin que iniciou o "Acessar como". */
export function stopImpersonation(): boolean {
  const adminToken = localStorage.getItem(IMPERSONATOR_TOKEN_KEY);
  localStorage.removeItem(IMPERSONATOR_TOKEN_KEY);
  if (!adminToken) return false;
  storeAccessToken(adminToken, DEFAULT_MAX_AGE_SECONDS);
  return true;
}
