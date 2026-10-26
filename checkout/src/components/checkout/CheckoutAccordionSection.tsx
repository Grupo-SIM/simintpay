'use client';

import { ChevronDown } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

export function CheckoutAccordionSection({
  title,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[22px] border transition-colors ${
        open
          ? 'border-white/[0.13] bg-white/[0.05]'
          : 'border-white/[0.07] bg-white/[0.04]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.12]">
          <Icon className="h-4 w-4 text-[#f6b67a]" />
        </span>
        <span className="flex-1 text-base font-medium text-[#f4f2f7] lg:text-[17px]">
          {title}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-[#a9a3b8] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
