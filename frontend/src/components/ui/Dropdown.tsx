'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { getPopupPosition } from '@/lib/popup-position';
import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { cn } from '@/lib/utils';

type Option = {
  selectedLabel?: string;
  label: string;
  value: string;
  disabled?: boolean;
};

type Props = {
  label?: string;
  error?: string;
  options: Option[];
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  theme?: 'light' | 'dark';
  variant?: 'default' | 'navbar';
  disabled?: boolean;
  className?: string;
  direction?: 'down' | 'up';
  portal?: boolean;
  required?: boolean;
  /** Mostra um campo de busca dentro do dropdown para filtrar as opções (listas grandes). */
  searchable?: boolean;
  searchPlaceholder?: string;
};

export function Dropdown({
  label,
  error,
  options,
  placeholder,
  value,
  onChange,
  theme = 'light',
  variant = 'default',
  disabled,
  className,
  direction = 'down',
  portal = true,
  required,
  searchable = false,
  searchPlaceholder,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [localQuery, updateQuery, flushQuery] = useDebouncedInput(
    query,
    setQuery,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      const trigger = rootRef.current?.querySelector('button');
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const height =
        Math.min(
          256,
          popupRef.current?.querySelector('ul')?.scrollHeight ?? 256,
        ) +
        (popupRef.current?.querySelector('input')?.parentElement
          ?.offsetHeight ?? 0) +
        2;
      setPopupStyle(
        getPopupPosition(
          rect,
          {
            width: document.documentElement.clientWidth,
            height: window.innerHeight,
          },
          rect.width,
          height,
          direction,
        ),
      );
    }

    function handle(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const insideRoot = rootRef.current?.contains(target);
      const insidePopup = popupRef.current?.contains(target);
      if (!insideRoot && !insidePopup) setOpen(false);
    }

    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    updatePosition();
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', onEsc);
    {
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
    }

    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', onEsc);
      {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      }
    };
  }, [open, portal, direction, localQuery, options]);

  // A closed dropdown has no search draft.
  if (!open && query !== '') setQuery('');

  function selectOption(option: Option) {
    onChange?.(option.value);
    setOpen(false);
    rootRef.current?.querySelector('button')?.focus();
  }

  const isDark = theme === 'dark';
  const selected = options.find((o) => o.value === value);
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const q = normalize(localQuery.trim());
  const filteredOptions =
    searchable && q
      ? options.filter(
          (o) =>
            normalize(o.label).includes(q) || normalize(o.value).includes(q),
        )
      : options;

  const dropdownContent = open ? (
    <div
      ref={popupRef}
      role="listbox"
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const buttons = [
          ...(popupRef.current?.querySelectorAll<HTMLButtonElement>(
            'li button:not(:disabled)',
          ) ?? []),
        ];
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === 'ArrowDown'
            ? current + 1
            : current < 0
              ? buttons.length - 1
              : current - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }}
      className={cn(
        'z-9999 flex flex-col overflow-hidden rounded-md border shadow-md',
        isDark
          ? 'border-white/10 bg-[#0b0b17] text-white'
          : 'border-zinc-200 bg-white text-zinc-900',
      )}
      style={popupStyle}
    >
      {searchable ? (
        <div
          className={cn(
            'shrink-0 border-b p-2',
            isDark
              ? 'border-white/10 bg-[#0b0b17]'
              : 'border-zinc-200 bg-white',
          )}
        >
          <input
            autoFocus
            type="text"
            value={localQuery}
            name="platform-option-search"
            aria-label={searchPlaceholder ?? 'Buscar opções'}
            onBlur={flushQuery}
            onChange={(e) => updateQuery(e.target.value)}
            placeholder={searchPlaceholder ?? 'Buscar...'}
            className={cn(
              'w-full rounded px-2 py-1.5 text-sm outline-none',
              isDark
                ? 'bg-white/5 text-white placeholder:text-white/40 focus:bg-white/10'
                : 'bg-zinc-100 text-zinc-900 placeholder:text-zinc-400 focus:bg-zinc-50',
            )}
          />
        </div>
      ) : null}
      <ul className="scrollbar-themed min-h-0 max-h-64 overflow-y-auto overscroll-contain">
        {filteredOptions.length === 0 ? (
          <li
            className={cn(
              'px-3 py-2 text-sm',
              isDark ? 'text-white/40' : 'text-zinc-400',
            )}
          >
            Nenhum resultado
          </li>
        ) : (
          filteredOptions.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  disabled={o.disabled}
                  role="option"
                  aria-selected={active}
                  className={cn(
                    'block w-full cursor-pointer px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50',
                    isDark
                      ? active
                        ? 'bg-white/10 text-white'
                        : 'hover:bg-white/5'
                      : active
                        ? 'bg-zinc-100 text-zinc-900'
                        : 'hover:bg-zinc-50',
                  )}
                  onClick={() => selectOption(o)}
                >
                  {o.label}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative flex flex-col gap-1 text-sm text-zinc-900 dark:text-zinc-100',
      )}
    >
      {label ? (
        <span id={`${id}-label`}>
          {label}
          {required ? <span className="text-red-500"> *</span> : null}
        </span>
      ) : null}
      <button
        id={id}
        aria-labelledby={label ? `${id}-label` : undefined}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              popupRef.current
                ?.querySelector<HTMLButtonElement>('li button:not(:disabled)')
                ?.focus(),
            );
          }
        }}
        className={cn(
          'relative h-11 cursor-pointer rounded-md border px-3 text-left outline-none transition-colors',
          'ring-zinc-900/10 focus:ring-4',
          isDark
            ? variant === 'navbar'
              ? 'border-white/10 bg-white/5 text-white/75 hover:bg-white/[0.07] hover:border-white/15 focus:border-violet-400/40 focus:ring-violet-300/20'
              : 'border-white/10 bg-[#070712] text-white hover:border-white/15 focus:ring-violet-300/20'
            : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50',
          disabled ? 'cursor-not-allowed opacity-60' : '',
          className,
        )}
      >
        <span
          className={cn(
            !selected ? (isDark ? 'text-white/40' : 'text-zinc-400') : '',
          )}
        >
          {selected?.selectedLabel ??
            selected?.label ??
            placeholder ??
            'Selecione'}
        </span>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center opacity-60">
          ▾
        </span>
      </button>

      {error ? <span className="text-xs text-red-500">{error}</span> : null}

      {dropdownContent
        ? typeof document !== 'undefined'
          ? createPortal(dropdownContent, document.body)
          : dropdownContent
        : null}
    </div>
  );
}
