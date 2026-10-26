'use client';

import type { ReactNode } from 'react';
import { cx } from '@/utils/cx';
import { GLASS } from '@/components/checkout/ui';

type Variant = 'default' | 'danger' | 'success';

const variantClass: Record<Variant, string> = {
  default: GLASS,
  danger:
    'border border-[rgba(255,160,160,.3)] bg-[rgba(255,140,140,.08)] backdrop-blur-[24px]',
  success:
    'border border-[rgba(123,227,176,.3)] bg-[rgba(123,227,176,.06)] backdrop-blur-[24px]',
};

/**
 * Painel de vidro do "Checkout Novo" (raio 28, blur, borda clara). Ver DESIGN.md.
 */
export function CheckoutUiCard({
  children,
  className,
  title,
  description,
  variant = 'default',
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  variant?: Variant;
}) {
  return (
    <section
      className={cx(
        'rounded-[28px] p-[18px] text-[#f4f2f7] lg:p-6',
        variantClass[variant],
        className,
      )}
    >
      {(title || description) && (
        <header className="mb-4 space-y-1">
          {title && (
            <h2 className="text-[19px] font-medium text-[#f4f2f7]">{title}</h2>
          )}
          {description && (
            <p className="text-[13px] text-[#a9a3b8]">{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
