'use client';

import { useEffect, useState } from 'react';
import Lottie from 'lottie-react';

type LottieData = Record<string, unknown>;

export function GestinComprasLottie() {
  const [data, setData] = useState<LottieData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(encodeURI('/Gestin de compras.json'), {
          cache: 'force-cache',
        });
        if (!res.ok) return;
        const json = (await res.json()) as LottieData;
        if (!cancelled) setData(json);
      } catch {
        // ignore
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return <div className="h-full w-full" />;
  }

  return (
    <Lottie animationData={data} loop autoplay className="h-full w-full" />
  );
}
