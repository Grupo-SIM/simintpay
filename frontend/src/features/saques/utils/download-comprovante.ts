import { getDefaultApiBaseUrl } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { resolveComprovanteUrl } from './comprovante-url';

export async function handleForceDownload(
  saqueId: string | null,
  storedUrl: string,
  filename: string,
) {
  const base = getDefaultApiBaseUrl().replace(/\/$/, '');
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (saqueId) {
    try {
      const res = await fetch(
        `${base}${endpoints.saque.comprovante(saqueId)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        return;
      }
    } catch {
      /* fallback */
    }
  }
  const resolved = resolveComprovanteUrl(storedUrl);
  try {
    const res = await fetch(resolved);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    const link = document.createElement('a');
    link.href = resolved;
    link.target = '_blank';
    link.download = filename;
    link.click();
  }
}
