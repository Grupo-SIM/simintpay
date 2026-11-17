'use client';
import { useEffect, useState } from 'react';

/**
 * Contagem regressiva do upsell/downsell. Só no cliente: começa quando a tela monta e não é
 * persistida. `seconds` ausente desativa o timer (nunca mostramos um prazo inventado).
 */
export function useFunnelCountdown(seconds: number | null | undefined) {
  const total = seconds && seconds > 0 ? Math.floor(seconds) : null;
  const [remaining, setRemaining] = useState<number | null>(total);

  useEffect(() => {
    if (total === null) return;
    const end = Date.now() + total * 1000;
    setRemaining(total);
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [total]);

  const left = remaining ?? 0;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return {
    enabled: total !== null,
    total: total ?? 0,
    remaining: left,
    expired: total !== null && left === 0,
    label: `${mm}:${ss}`,
  };
}
