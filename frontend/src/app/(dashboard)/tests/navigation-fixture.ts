import { useMemo, useSyncExternalStore } from 'react';
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const snapshot = () => location.pathname + location.search;
const move = (url: string, replace = false) => {
  if (snapshot() === url) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
};
const router = {
  push: (url: string) => move(url),
  replace: (url: string) => move(url, true),
  back: () => history.back(),
  refresh: () => {},
};
export const useRouter = () => router;
export const usePathname = () =>
  useSyncExternalStore(subscribe, snapshot).split('?')[0];
export function useSearchParams() {
  const path = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => new URLSearchParams(path.split('?')[1] ?? ''), [path]);
}
export const useParams = () => ({ id: 'test' });
