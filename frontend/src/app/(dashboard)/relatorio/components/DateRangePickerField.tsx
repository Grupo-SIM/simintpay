'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { DateRange } from '../types';
import { formatRange, isSameDay, rangeDays, startOfDay } from '../utils';
import { ActionButton } from './ActionButton';

type Props = {
  label: string;
  value: DateRange;
  onChange: (next: DateRange) => void;
  theme: 'light' | 'dark';
};

export function DateRangePickerField({ label, value, onChange, theme }: Props) {
  const today = startOfDay(new Date());
  const initialStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 10,
  );
  const initialEnd = today;

  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'days' | 'months'>('days');
  const [monthCursor, setMonthCursor] = useState(
    new Date(initialEnd.getFullYear(), initialEnd.getMonth(), 1),
  );
  const [draftRange, setDraftRange] = useState<DateRange>(
    value.start || value.end ? value : { start: initialStart, end: initialEnd },
  );
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  function updatePosition() {
    if (!triggerRef.current || !popupRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popupHeight = popupRef.current.offsetHeight || 480;
    const popupWidth = 380;
    const margin = 8;

    let left = rect.left;
    if (left + popupWidth > window.innerWidth - margin)
      left = rect.right - popupWidth;
    if (left < margin) left = margin;

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const openUpward =
      spaceBelow < popupHeight && rect.top > popupHeight + margin;

    setPopupStyle({
      position: 'fixed',
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 8 }
        : { top: rect.bottom + 8 }),
      left,
      width: popupWidth,
      zIndex: 9999,
    });
  }

  // Re-posiciona após o portal montar (para medir a altura real do popup)
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (e.key === 'Escape') {
        setOpen(false);
        setViewMode('days');
      }
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

  function handleDateClick(clickedDate: Date) {
    if (!draftRange.start || draftRange.end) {
      setDraftRange({ start: clickedDate, end: null });
      setHoverDate(null);
      return;
    }
    if (clickedDate.getTime() < draftRange.start.getTime()) {
      setDraftRange({ start: clickedDate, end: draftRange.start });
      setHoverDate(null);
      return;
    }
    if (isSameDay(clickedDate, draftRange.start)) {
      setDraftRange({ start: clickedDate, end: clickedDate });
      setHoverDate(null);
      return;
    }
    setDraftRange({ start: draftRange.start, end: clickedDate });
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

  const popup = (
    <div
      ref={popupRef}
      style={popupStyle}
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
          onClick={() => {
            if (viewMode === 'months')
              setMonthCursor(
                new Date(
                  monthCursor.getFullYear() - 1,
                  monthCursor.getMonth(),
                  1,
                ),
              );
            else
              setMonthCursor(
                new Date(
                  monthCursor.getFullYear(),
                  monthCursor.getMonth() - 1,
                  1,
                ),
              );
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setViewMode((v) => (v === 'days' ? 'months' : 'days'))}
          className="text-lg font-semibold capitalize text-zinc-800 hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400 transition-colors"
        >
          {viewMode === 'months'
            ? monthCursor.getFullYear()
            : monthCursor.toLocaleDateString('pt-BR', {
                month: 'long',
                year: 'numeric',
              })}
        </button>
        <button
          type="button"
          onClick={() => {
            if (viewMode === 'months')
              setMonthCursor(
                new Date(
                  monthCursor.getFullYear() + 1,
                  monthCursor.getMonth(),
                  1,
                ),
              );
            else
              setMonthCursor(
                new Date(
                  monthCursor.getFullYear(),
                  monthCursor.getMonth() + 1,
                  1,
                ),
              );
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {viewMode === 'months' ? (
        <div className="grid grid-cols-3 gap-2 pb-1">
          {[
            'Jan',
            'Fev',
            'Mar',
            'Abr',
            'Mai',
            'Jun',
            'Jul',
            'Ago',
            'Set',
            'Out',
            'Nov',
            'Dez',
          ].map((nome, idx) => {
            const isCurrentMonth =
              monthCursor.getFullYear() === today.getFullYear() &&
              idx === today.getMonth();
            return (
              <button
                key={nome}
                type="button"
                onClick={() => {
                  setMonthCursor(new Date(monthCursor.getFullYear(), idx, 1));
                  setViewMode('days');
                }}
                className={[
                  'rounded-lg py-2 text-sm font-medium transition-colors',
                  isCurrentMonth
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10',
                ].join(' ')}
              >
                {nome}
              </button>
            );
          })}
        </div>
      ) : null}

      {viewMode === 'days' ? (
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
                ? 'bg-emerald-700 text-white rounded-full hover:bg-emerald-800'
                : 'rounded-full hover:bg-zinc-100 dark:hover:bg-white/10';

            return (
              <button
                type="button"
                key={date.toISOString()}
                onClick={() => handleDateClick(startOfDay(date))}
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
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3 dark:border-white/10">
        <ActionButton
          onClick={() => {
            setDraftRange({ start: null, end: null });
            onChange({ start: null, end: null });
          }}
        >
          Limpar
        </ActionButton>
        <ActionButton
          variant="primary"
          onClick={() => {
            onChange(draftRange);
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
      <span>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setDraftRange(value);
          setMonthCursor(
            new Date(
              (value.end ?? today).getFullYear(),
              (value.end ?? today).getMonth(),
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
            {formatRange(value) || 'Selecione o periodo'}
          </span>
        </span>
        {value.start || value.end ? (
          <span
            className="ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            onClick={(e) => {
              e.stopPropagation();
              onChange({ start: null, end: null });
              setDraftRange({ start: null, end: null });
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
