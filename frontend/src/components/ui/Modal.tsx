'use client';

import type { ReactNode } from 'react';
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  title?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  maxWidth?: string;
  /** Classes extras no card (título + corpo) — use "dark" para forçar tema escuro nesta modal. */
  contentClassName?: string;
};

export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  maxWidth = 'max-w-lg',
  contentClassName,
}: Props) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-hidden">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
        aria-hidden
      />

      {/* Content */}
      <div
        className={cn(
          'relative z-10 w-full overflow-hidden rounded-3xl border bg-white p-6 shadow-xl backdrop-blur-xl animate-in fade-in zoom-in duration-300 flex flex-col max-h-[90vh]',
          'border-zinc-200 dark:border-white/20 dark:bg-zinc-950/80 dark:shadow-2xl',
          maxWidth,
          contentClassName,
        )}
      >
        <div className="mb-6 flex shrink-0 items-center justify-between">
          {title ? (
            <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
              {title}
            </h3>
          ) : (
            <div />
          )}

          <button
            type="button"
            className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 dark:hover:text-white"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-6 overflow-y-auto overflow-x-hidden pr-2 flex-1 custom-scrollbar">
          {children}
        </div>

        {footer ? (
          <div className="flex shrink-0 justify-end gap-3 pt-4 border-t border-white/5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
