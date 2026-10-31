'use client';

import type { ComponentProps } from 'react';
import { Users, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Button } from '@/components/ui/Button';
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/Dialog';

export function CoproductionDialogContent({
  description,
  pending = false,
  onClose,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogContent>, 'title'> & {
  description: string;
  pending?: boolean;
  onClose: () => void;
}) {
  return (
    <DialogContent
      {...props}
      showCloseButton={false}
      overlayClassName="bg-black/60 backdrop-blur-sm"
      className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-2xl border-zinc-200 bg-[var(--dashboard-sidebar-bg)] p-0 text-zinc-900 shadow-xl duration-300 sm:max-w-xl dark:border-white/10 dark:text-slate-100 dark:shadow-2xl"
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-zinc-200 p-6 dark:border-white/10">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#7c3aed] dark:text-[#a78bfa]">
          <Users size={22} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-lg font-bold leading-6 tracking-tight">
            Co-produção
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {description}
          </DialogDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 rounded-full border-zinc-200 text-zinc-500 dark:border-white/10 bg-transparent hover:bg-zinc-100 dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10"
          aria-label="Fechar co-produção"
          disabled={pending}
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      <ScrollArea className="min-h-0 space-y-5 p-6">{children}</ScrollArea>
    </DialogContent>
  );
}
