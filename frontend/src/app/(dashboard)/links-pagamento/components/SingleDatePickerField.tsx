'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';

type Props = {
  label: string;
  required?: boolean;
  value: Date | null;
  onChange: (next: Date | null) => void;
  theme: 'light' | 'dark';
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatSingleDate(value: Date | null) {
  if (!value) return '';
  return value.toLocaleDateString('pt-BR');
}

export function SingleDatePickerField({
  label,
  value,
  onChange,
  theme,
  required = false,
}: Props) {
  const today = startOfDay(new Date());
  const [open, setOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(
    new Date((value ?? today).getFullYear(), (value ?? today).getMonth(), 1),
  );
  const [draftDate, setDraftDate] = useState<Date | null>(value);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  function updatePosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    const height = popupRef.current?.offsetHeight ?? 440;
    setPopupStyle({
      position: 'fixed',
      top: Math.max(
        8,
        Math.min(rect.bottom + 8, window.innerHeight - height - 8),
      ),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      maxHeight: 'calc(100dvh - 16px)',
      zIndex: 9999,
    });
  }

  useEffect(() => {
    if (!open) return;
    updatePosition();

    function onOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popupRef.current &&
        !popupRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    function onScroll() {
      updatePosition();
    }

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

  const calendarDays = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const firstDayWeekIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const normalizedStart = (firstDayWeekIndex + 6) % 7;
    const days: Array<{ date: Date; currentMonth: boolean }> = [];

    for (let i = normalizedStart - 1; i >= 0; i -= 1) {
      days.push({
        date: new Date(year, month - 1, daysInPrevMonth - i),
        currentMonth: false,
      });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      days.push({ date: new Date(year, month, day), currentMonth: true });
    }
    while (days.length < 42) {
      const nextDay = days.length - (normalizedStart + daysInMonth) + 1;
      days.push({
        date: new Date(year, month + 1, nextDay),
        currentMonth: false,
      });
    }
    return days;
  }, [monthCursor]);

  const weekDays = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

  const popup = (
    <div
      ref={popupRef}
      style={popupStyle}
      className="custom-scrollbar overflow-y-auto dropdown-animate-portal rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-950"
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            setMonthCursor(
              new Date(
                monthCursor.getFullYear(),
                monthCursor.getMonth() - 1,
                1,
              ),
            )
          }
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-lg font-semibold capitalize text-zinc-800 dark:text-zinc-100">
          {monthCursor.toLocaleDateString('pt-BR', {
            month: 'long',
            year: 'numeric',
          })}
        </p>
        <button
          type="button"
          onClick={() =>
            setMonthCursor(
              new Date(
                monthCursor.getFullYear(),
                monthCursor.getMonth() + 1,
                1,
              ),
            )
          }
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day, i) => (
          <div
            key={`${day}-${i}`}
            className="py-1 text-center text-xs font-semibold uppercase text-zinc-400 dark:text-zinc-500"
          >
            {day}
          </div>
        ))}
        {calendarDays.map(({ date, currentMonth }) => {
          const selected = draftDate ? isSameDay(date, draftDate) : false;
          const isToday = isSameDay(date, today);
          return (
            <button
              type="button"
              key={date.toISOString()}
              onClick={() => setDraftDate(startOfDay(date))}
              className={[
                'h-10 rounded-full text-sm transition-colors',
                selected
                  ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                  : currentMonth
                    ? isToday
                      ? 'border border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-500/10'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10'
                    : 'text-zinc-300 hover:bg-zinc-100 dark:text-zinc-600 dark:hover:bg-white/10',
              ].join(' ')}
            >
              {date.getDate().toString().padStart(2, '0')}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3 dark:border-white/10">
        <ActionButton
          onClick={() => {
            setDraftDate(null);
            onChange(null);
          }}
        >
          Limpar
        </ActionButton>
        <ActionButton
          variant="primary"
          onClick={() => {
            onChange(draftDate);
            setOpen(false);
          }}
        >
          Aplicar
        </ActionButton>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
      <span>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <button
        aria-label={label}
        ref={triggerRef}
        type="button"
        onClick={() => {
          setDraftDate(value);
          setMonthCursor(
            new Date(
              (value ?? today).getFullYear(),
              (value ?? today).getMonth(),
              1,
            ),
          );
          setOpen((v) => !v);
        }}
        className={[
          'flex h-11 items-center justify-between rounded-md px-3 text-left outline-none transition-colors focus:ring-4',
          theme === 'dark'
            ? 'border border-white/10 bg-white/5 text-white/75 hover:bg-white/[0.07] hover:border-white/15 focus:border-violet-400/40 focus:ring-violet-300/20'
            : 'border border-zinc-200 bg-white text-zinc-900 ring-zinc-900/10 hover:bg-zinc-50',
        ].join(' ')}
      >
        <span className="inline-flex items-center gap-2 truncate">
          <CalendarDays className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <span className="truncate">
            {formatSingleDate(value) || 'Selecione uma data'}
          </span>
        </span>
        {value ? (
          <span
            className="ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              setDraftDate(null);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(popup, document.body)
        : null}
    </div>
  );
}
