import { type ReactNode } from 'react';

/** Pílula neutra (ex.: "Aguardando pagamento…", "Nada foi cobrado") no lugar do CTA. */
export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[58px] items-center justify-center gap-2.5 rounded-full border border-white/[0.13] bg-white/[0.07] text-[15px] text-[#d9d4e3]">
      {children}
    </div>
  );
}
