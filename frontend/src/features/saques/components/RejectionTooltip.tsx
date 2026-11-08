'use client';

import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function RejectionTooltip({
  children,
  reason,
}: {
  children: ReactNode;
  reason: string;
}) {
  // Portal com position:fixed — o tooltip ficava dentro do overflow-auto da tabela
  // e era cortado pelas linhas vizinhas; via portal ele sobrepõe tudo.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const mostrar = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top - 8, left: r.left + r.width / 2 });
  };

  return (
    <div
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={mostrar}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              transform: 'translate(-50%, -100%)',
              zIndex: 9999,
            }}
            className={[
              'pointer-events-none w-60',
              'rounded-xl border border-zinc-700/60 bg-zinc-900 px-3 py-2.5 shadow-xl',
              'dark:border-white/10 dark:bg-zinc-800',
            ].join(' ')}
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-400">
              Motivo da recusa
            </p>
            <p className="text-xs leading-relaxed text-zinc-100">{reason}</p>
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-800" />
          </div>,
          document.body,
        )}
    </div>
  );
}
