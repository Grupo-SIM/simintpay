import { cookies } from 'next/headers';
import { createApiClient, getDefaultApiBaseUrl } from './api.client';

export async function getServerToken() {
  const store = await cookies();
  return store.get('access_token')?.value;
}

export async function createServerApiClient() {
  const token = await getServerToken();

  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) throw new Error('API_BASE_URL não está definida no .env');

  return createApiClient({
    baseUrl,
    getToken: () => token,
  });
}
