const ACCESS_TOKEN_KEY = 'access_token';
const COOKIE_NAME = 'access_token';

/**
 * Remove o token de acesso do localStorage e do cookie.
 * Use ao fazer logout ou quando o cookie tiver expirado/sido removido.
 */
export function clearAccessToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Verifica se existe token no cookie (fonte de verdade para sessão).
 */
export function hasAccessTokenCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return /(?:^|;\s*)access_token=([^;]+)/.test(document.cookie);
}
