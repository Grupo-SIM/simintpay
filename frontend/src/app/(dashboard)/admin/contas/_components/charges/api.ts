import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
export function chargesApi() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}
export const money = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function checkoutUrl(ref: string) {
  const base = process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL;
  return base ? `${base}/?simLinkCode=${encodeURIComponent(ref)}` : null;
}
