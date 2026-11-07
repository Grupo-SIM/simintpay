'use client';
import { useId, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { buildInstallmentLabel } from '@/lib/installment-label';
type Option = {
  installments: number;
  totalAmount: number;
  installmentAmount: number;
  interestAmount?: number;
};
const money = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const label = (o: Option) =>
  buildInstallmentLabel({
    installments: o.installments,
    perInstallment: o.installmentAmount,
    total: o.totalAmount,
    interestAmount: o.interestAmount,
    formatCurrency: money,
  });
export function InstallmentSelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Option[];
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.installments === value);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const buttons = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role=option]',
            ),
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? buttons.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                  buttons.length
          ]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label="Parcelas"
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              document
                .getElementById(id)
                ?.querySelector<HTMLButtonElement>('[aria-selected=true]')
                ?.focus(),
            );
          }
        }}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[16px] border border-white/15 bg-white/[0.06] px-4 py-3 text-left text-sm text-white disabled:opacity-50"
      >
        <span>{selected ? label(selected) : 'Calculando parcelas…'}</span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label="Parcelas"
          className="absolute bottom-full z-30 mb-2 max-h-72 w-full overflow-auto rounded-[16px] border border-white/20 bg-[#24212f] p-1 shadow-xl"
        >
          {options.map((o) => (
            <button
              key={o.installments}
              type="button"
              role="option"
              aria-selected={value === o.installments}
              onClick={() => {
                onChange(o.installments);
                close();
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-3 text-left text-sm text-white hover:bg-white/10 focus:bg-white/10 focus:outline-none"
            >
              <span>
                {label(o)} · Total {money(o.totalAmount)}
              </span>
              {value === o.installments && (
                <Check className="h-4 w-4 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
