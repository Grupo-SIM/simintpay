'use client';

import { useEffect, useState } from 'react';

/**
 * Contagem regressiva até `expire` (string de data do backend).
 * Retorna "mm:ss", ou null se a data não for interpretável (aí mostramos o texto cru).
 */
export function useCountdown(expire: string | null): string | null {
  const target = parseExpire(expire);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (target == null) return null;
  const left = Math.max(0, Math.floor((target - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

function parseExpire(expire: string | null): number | null {
  if (!expire) return null;
  const trimmed = expire.trim();
  // "YYYY-MM-DD HH:mm:ss" → ISO (Safari não aceita o espaço)
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
