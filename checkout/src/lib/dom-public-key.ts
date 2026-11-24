import { SIM_API_URL } from '@/lib/api-config';

let cached: Promise<string> | undefined;

/** Chave pública do gateway (tokenização de cartão no navegador), obtida do backend e guardada em memória. */
export function fetchDomPublicKey(): Promise<string> {
  cached ??= fetch(`${SIM_API_URL}/ofertas/public/card-public-key`)
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.publicKey)
        throw new Error('Chave pública do gateway indisponível');
      return String(data.publicKey);
    })
    .catch((error) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
