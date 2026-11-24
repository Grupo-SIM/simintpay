'use client';

import type { ReactNode } from 'react';
import { FormSwitch } from '@/components/ui/FormSwitch';
import type { ShareDraft } from '@/features/participations/types';
import { PercentageField } from './PercentageField';

/** Uma das quatro participações da pessoa: liga/desliga e percentual próprio. */
export function PersonShareSection({
  title,
  description,
  name,
  share,
  placeholder,
  hint,
  disabled = false,
  note,
  onChange,
  children,
}: {
  title: string;
  description: string;
  name: string;
  share: ShareDraft;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  /** Aviso exibido quando a participação está ligada. */
  note?: ReactNode;
  onChange: (share: ShareDraft) => void;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        </div>
        <FormSwitch
          aria-label={title}
          checked={share.on && !disabled}
          onChange={(on) => {
            if (!disabled) onChange({ ...share, on });
          }}
        />
      </div>
      {share.on && !disabled && (
        <>
          <PercentageField
            label="Percentual"
            name={name}
            value={share.percentage}
            placeholder={placeholder}
            hint={hint}
            onChange={(percentage) => onChange({ ...share, percentage })}
          />
          {note}
          {children}
        </>
      )}
    </section>
  );
}
