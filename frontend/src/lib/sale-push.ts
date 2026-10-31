import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { ApiError } from '@/services/api/types';

const OWNER_KEY = 'sale_push_owner';

export function supportsSalePush() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function api() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

async function registration() {
  return navigator.serviceWorker.register('/sale-push-sw.js', { scope: '/' });
}

export async function getSalePushSubscription() {
  if (!supportsSalePush()) return null;
  const worker =
    await navigator.serviceWorker.getRegistration('/sale-push-sw.js');
  return worker ? worker.pushManager.getSubscription() : null;
}

export function salePushOwner() {
  return localStorage.getItem(OWNER_KEY);
}

export async function disableSalePush() {
  const subscription = await getSalePushSubscription();
  if (subscription) {
    // Keep session and subscription intact when removal fails; user can retry.
    await api().delete('/notifications/push/subscriptions', {
      body: { endpoint: subscription.endpoint },
    });
    if (!(await subscription.unsubscribe()))
      throw new Error(
        'Não foi possível desativar este dispositivo. Tente novamente.',
      );
  }
  localStorage.removeItem(OWNER_KEY);
}

export async function enableSalePush(userId: string) {
  if (!supportsSalePush())
    throw new Error(
      'Este navegador não oferece notificações em segundo plano. Use um navegador compatível com HTTPS.',
    );
  // Permission is requested only from the user's button click.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(
      'Permissão de notificações não concedida. Revise as permissões do navegador.',
    );
  const response = await api().get<{ data: { publicKey: string } }>(
    '/notifications/push/public-key',
  );
  const key = response.data.publicKey;
  const bytes = Uint8Array.from(
    atob(key.replace(/-/g, '+').replace(/_/g, '/')),
    (char) => char.charCodeAt(0),
  );
  await registration();
  const worker = await navigator.serviceWorker.ready;
  const existing = await worker.pushManager.getSubscription();
  const subscription =
    existing ??
    (await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }));
  try {
    await api().post(
      '/notifications/push/subscriptions',
      subscription.toJSON(),
    );
    localStorage.setItem(OWNER_KEY, userId);
  } catch (error) {
    if (!existing) await subscription.unsubscribe();
    throw error;
  }
}

export async function reconcileSalePushOwner(userId: string) {
  if (salePushOwner() && salePushOwner() !== userId) {
    const subscription = await getSalePushSubscription();
    if (subscription && !(await subscription.unsubscribe()))
      throw new Error(
        'Não foi possível remover notificações da conta anterior.',
      );
    localStorage.removeItem(OWNER_KEY);
  }
}

/** An expired session must not trap the user on login with an unusable token. */
export async function prepareSalePushAccountChange() {
  if (localStorage.getItem('access_token')) {
    try {
      await disableSalePush();
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.status))
        throw error;
    }
  }
  // Session already ended. Invalidate old endpoint locally; server removes it on 404/410.
  const subscription = await getSalePushSubscription();
  if (subscription && !(await subscription.unsubscribe()))
    throw new Error('Não foi possível remover notificações da conta anterior.');
  localStorage.removeItem(OWNER_KEY);
}
