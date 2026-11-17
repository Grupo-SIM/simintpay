import { useEffect, useState } from 'react';
import { fetchPixInviteLink } from '@/components/telegram-success/api';

// O webhook do PagaTG precisa de um instante para gravar o registro (mesmo backoff do legado).
const DELAYS_MS = [1000, 1000, 2000, 3000, 5000, 5000, 5000, 5000];

/** Link do grupo do Telegram de uma oferta de plano PIX, buscado após o pagamento confirmado. */
export function usePixPlanInvite(
  pixPlanCode: string | null | undefined,
  email: string,
  enabled: boolean,
) {
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!enabled || !pixPlanCode || !email) return;
    let cancelled = false;
    setFetching(true);
    (async () => {
      for (const delay of DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled) return;
        const link = await fetchPixInviteLink(pixPlanCode, email);
        if (cancelled) return;
        if (link) {
          setInviteLink(link);
          setFetching(false);
          return;
        }
      }
      setFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, pixPlanCode, email]);

  return { inviteLink, fetching };
}
