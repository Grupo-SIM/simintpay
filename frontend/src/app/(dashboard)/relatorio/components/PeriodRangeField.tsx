'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DateRange, PeriodPreset } from '../types';
import { formatRange, isSameDay, rangeDays, startOfDay } from '../utils';
import { ActionButton } from './ActionButton';

type Props = {
  theme: 'light' | 'dark';
  preset: PeriodPreset;
  customRange: DateRange;
  effectiveRange: DateRange;
  onPeriodChange: (next: {
    preset: PeriodPreset;
    customRange?: DateRange;
  }) => void;
};

export function PeriodRangeField({
  theme,
  preset,
  customRange,
  effectiveRange,
  onPeriodChange,
}: Props) {
  const today = startOfDay(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange>(effectiveRange);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarPopupRef = useRef<HTMLDivElement>(null);
  const [calendarStyle, setCalendarStyle] = useState<React.CSSProperties>({});

  function updateCalendarPosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCalendarStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left: rect.left,
      width: 380,
      zIndex: 9999,
    });
  }

  useEffect(() => {
    if (!calendarOpen) return;
    updateCalendarPosition();
    function onOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        calendarPopupRef.current?.contains(t)
      )
        return;
      setCalendarOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setCalendarOpen(false);
    }
    window.addEventListener('scroll', updateCalendarPosition, true);
    window.addEventListener('resize', updateCalendarPosition);
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('scroll', updateCalendarPosition, true);
      window.removeEventListener('resize', updateCalendarPosition);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [calendarOpen]);

  const triggerLabel =
    preset === 'custom' && customRange.start && customRange.end
      ? formatRange(customRange)
      : 'Mês atual';

  function openCalendar() {
    const now = new Date();
    const seed =
      preset === 'custom' && customRange.start && customRange.end
        ? customRange
        : effectiveRange.start && effectiveRange.end
          ? effectiveRange
          : { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    setDraftRange(seed);
    setMonthCursor(
      new Date(
        (seed.end ?? today).getFullYear(),
        (seed.end ?? today).getMonth(),
        1,
      ),
    );
    onPeriodChange({ preset: 'custom', customRange: seed });
    setCalendarOpen(true);
  }

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

  function handleDateClick(clickedDate: Date) {
    const d = startOfDay(clickedDate);
    if (!draftRange.start || draftRange.end) {
      setDraftRange({ start: d, end: null });
      setHoverDate(null);
      return;
    }
    if (d.getTime() < draftRange.start.getTime()) {
      setDraftRange({ start: d, end: draftRange.start });
      setHoverDate(null);
      return;
    }
    if (isSameDay(d, draftRange.start)) {
      setDraftRange({ start: d, end: d });
      setHoverDate(null);
      return;
    }
    setDraftRange({ start: draftRange.start, end: d });
    setHoverDate(null);
  }

  const visualRange = useMemo(() => {
    if (!draftRange.start) return { start: null, end: null } as DateRange;
    const endCandidate = draftRange.end ?? hoverDate;
    if (!endCandidate)
      return { start: draftRange.start, end: null } as DateRange;
    return endCandidate.getTime() >= draftRange.start.getTime()
      ? { start: draftRange.start, end: endCandidate }
      : { start: endCandidate, end: draftRange.start };
  }, [draftRange, hoverDate]);

  const selectedDays = rangeDays(visualRange);
  const weekDays = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

  const triggerClass = cn(
    'flex h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm outline-none transition-colors focus:ring-4',
    theme === 'dark'
      ? 'border border-white/10 bg-white/5 text-white/90 hover:border-white/15 hover:bg-white/7 focus:border-violet-400/40 focus:ring-violet-300/20'
      : 'border border-zinc-200 bg-white text-zinc-900 ring-zinc-900/10 hover:bg-zinc-50 focus:border-zinc-400 focus:ring-zinc-400/20',
  );

  const calendarPopup = (
    <div
      ref={calendarPopupRef}
      style={calendarStyle}
      className="dropdown-animate-portal rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-950"
    >
      {selectedDays > 0 ? (
        <div className="mb-3 flex justify-center">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
            {selectedDays} dia(s) selecionado(s)
          </span>
        </div>
      ) : null}

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

      <div
        className="grid grid-cols-7 gap-1"
        onMouseLeave={() => setHoverDate(null)}
      >
        {weekDays.map((day, i) => (
          <div
            key={`${day}-${i}`}
            className="py-1 text-center text-xs font-semibold uppercase text-zinc-400 dark:text-zinc-500"
          >
            {day}
          </div>
        ))}
        {calendarDays.map(({ date, currentMonth }) => {
          const isStart = draftRange.start
            ? isSameDay(date, draftRange.start)
            : false;
          const isHoverEnd =
            !draftRange.end && hoverDate ? isSameDay(date, hoverDate) : false;
          const isEnd = draftRange.end
            ? isSameDay(date, draftRange.end)
            : isHoverEnd;
          const isToday = isSameDay(date, today);
          const inRange =
            visualRange.start && visualRange.end
              ? date.getTime() >= startOfDay(visualRange.start).getTime() &&
                date.getTime() <= startOfDay(visualRange.end).getTime()
              : false;

          const mutedClass =
            isStart || isEnd
              ? ''
              : currentMonth
                ? 'text-zinc-700 dark:text-zinc-200'
                : 'text-zinc-300 dark:text-zinc-600';
          const rangeClass =
            inRange && !isStart && !isEnd
              ? 'rounded-none bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200'
              : '';
          const todayClass =
            isToday && !isStart && !isEnd && !inRange
              ? 'border border-emerald-500 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300'
              : '';
          const edgeClass =
            isStart || isEnd
              ? 'rounded-full bg-emerald-700 text-white hover:bg-emerald-800'
              : 'rounded-full hover:bg-zinc-100 dark:hover:bg-white/10';

          return (
            <button
              type="button"
              key={date.toISOString()}
              onClick={() => handleDateClick(date)}
              onMouseEnter={() => {
                if (draftRange.start && !draftRange.end)
                  setHoverDate(startOfDay(date));
              }}
              className={`h-10 text-sm transition-colors ${mutedClass} ${rangeClass} ${todayClass} ${edgeClass}`}
            >
              {date.getDate().toString().padStart(2, '0')}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3 dark:border-white/10">
        <ActionButton
          onClick={() => {
            setDraftRange({ start: null, end: null });
          }}
        >
          Limpar
        </ActionButton>
        <ActionButton
          variant="primary"
          onClick={() => {
            if (draftRange.start && draftRange.end) {
              onPeriodChange({ preset: 'custom', customRange: draftRange });
              setCalendarOpen(false);
            }
          }}
          disabled={!draftRange.start || !draftRange.end}
        >
          Aplicar
        </ActionButton>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
      <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
        <CalendarDays
          className="h-4 w-4 text-zinc-500 dark:text-zinc-400"
          aria-hidden
        />
        Período:
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (calendarOpen) {
            setCalendarOpen(false);
          } else {
            openCalendar();
          }
        }}
        className={triggerClass}
        aria-expanded={calendarOpen}
        aria-haspopup="dialog"
      >
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-zinc-500 transition-transform dark:text-zinc-400',
            calendarOpen && 'rotate-180',
          )}
        />
      </button>

      {calendarOpen && typeof document !== 'undefined'
        ? createPortal(calendarPopup, document.body)
        : null}
    </div>
  );
}
