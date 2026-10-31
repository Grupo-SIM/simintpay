'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, SlidersHorizontal } from 'lucide-react';
import { ActionButton } from './ActionButton';

type Props = {
  options: readonly string[];
  selectedMap: Record<string, boolean>;
  onToggle: (key: string) => void;
};

export function DataColumnsDropdown({ options, selectedMap, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selectedCount = Object.values(selectedMap).filter(Boolean).length;

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPopupStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left: rect.right - 270,
        width: 270,
        zIndex: 9999,
      });
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

    function onScroll() {
      updatePosition();
    }

    updatePosition();
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  return (
    <div ref={triggerRef} className="relative">
      <ActionButton onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal className="h-4 w-4" />
        Dados
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-300 px-1 text-xs dark:border-white/20">
          {selectedCount}
        </span>
      </ActionButton>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popupRef}
              style={popupStyle}
              className="dropdown-animate-portal rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-zinc-900"
            >
              <div className="max-h-80 overflow-auto pr-1">
                {options.map((option) => {
                  const checked = selectedMap[option];
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onToggle(option)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10"
                    >
                      <span>{option}</span>
                      <span
                        className={[
                          'inline-flex h-4 w-4 items-center justify-center rounded border',
                          checked
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-zinc-300 bg-transparent text-transparent dark:border-white/20',
                        ].join(' ')}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
