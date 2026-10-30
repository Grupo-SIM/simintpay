'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getPopupPosition } from '@/lib/popup-position';
import { MoreVertical } from 'lucide-react';

export type RowActionMenuItem<TAction extends string> = {
  action: TAction;
  label: string;
  icon: ReactNode;
  className?: string;
};

type Props<TAction extends string> = {
  rowId: string;
  fieldTheme: 'light' | 'dark';
  ariaLabel: string;
  items: RowActionMenuItem<TAction>[];
  onAction?: (action: TAction, rowId: string) => void;
  menuWidth?: number;
};

export function RowActionsMenu<TAction extends string>({
  rowId,
  fieldTheme,
  ariaLabel,
  items,
  onAction,
  menuWidth = 200,
}: Props<TAction>) {
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPopupStyle(
        getPopupPosition(
          rect,
          {
            width: document.documentElement.clientWidth,
            height: window.innerHeight,
          },
          menuWidth,
          popupRef.current?.scrollHeight ?? items.length * 40 + 12,
          'down',
          'end',
        ),
      );
    }

    function onOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popupRef.current &&
        !popupRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    function onEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    updatePosition();
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [menuWidth, open, items.length]);

  const isDark = fieldTheme === 'dark';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-950/10 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popupRef}
              style={popupStyle}
              className={[
                'scrollbar-themed overflow-y-auto overscroll-contain rounded-xl border p-1.5 shadow-xl',
                isDark
                  ? 'border-white/10 bg-[#0b0b17] text-white'
                  : 'border-zinc-200 bg-white text-zinc-900',
              ].join(' ')}
            >
              {items.map((item) => (
                <button
                  key={item.action}
                  type="button"
                  className={[
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors',
                    item.className ??
                      (isDark ? 'text-zinc-200' : 'text-slate-700'),
                    isDark ? 'hover:bg-white/10' : 'hover:bg-zinc-100',
                  ].join(' ')}
                  onClick={() => {
                    onAction?.(item.action, rowId);
                    setOpen(false);
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
