'use client';

import { AlertCircle, Check } from 'lucide-react';
import { CheckoutUiCard } from '@/components/checkout/CheckoutUiCard';

export type CheckoutStatusItem = { ok: boolean; label: string };

/**
 * Validações e feedback em tempo real (estilo "Checkout Novo").
 */
export function CheckoutStatusCard({
  error,
  items,
}: {
  error: string;
  items: CheckoutStatusItem[];
}) {
  if (error) {
    return (
      <CheckoutUiCard variant="danger" className="rounded-[22px] p-4 lg:p-4">
        <div className="flex gap-2.5">
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9d9d]"
            aria-hidden
          />
          <p className="text-sm leading-relaxed text-[#ffd0d0]">{error}</p>
        </div>
      </CheckoutUiCard>
    );
  }

  return (
    <ul className="flex flex-col gap-2 px-1">
      {items.map((it) => (
        <li
          key={it.label}
          className="flex items-center gap-2.5 text-[13px] text-[#a9a3b8]"
        >
          {it.ok ? (
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#a99ef8,#f6b67a)]">
              <Check
                className="h-2.5 w-2.5 text-[#17131f]"
                strokeWidth={3}
                aria-hidden
              />
            </span>
          ) : (
            <span className="h-[18px] w-[18px] shrink-0 rounded-full bg-white/[0.12]" />
          )}
          <span className={it.ok ? 'text-[#d9d4e3]' : undefined}>
            {it.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
