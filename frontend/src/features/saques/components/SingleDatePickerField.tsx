'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatYmd } from '../utils/ymd';

type Props = {
  label: string;
  /** YYYY-MM-DD */
  value: string;
  onChange: (ymd: string) => void;
  /** YYYY-MM-DD; dias posteriores ficam desabilitados. */
  max?: string;
  theme: 'light' | 'dark';
  disabled?: boolean;
};

const WEEK_DAYS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function parseYmd(ymd: string): { y: number; m: number } {
  const match = ymd.match(/^(\d{4})-(\d{2})-/);
  if (!match) {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  }
  return { y: Number(match[1]), m: Number(match[2]) - 1 };
}

/** Seletor de uma única data (valor YYYY-MM-DD, sem conversão de fuso). */
export function SingleDatePickerField({
  label,
  value,
  onChange,
  max,
  theme,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => parseYmd(value || max || ''));
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  function updatePosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = 300;
    const margin = 8;
    const popupHeight = popupRef.current?.offsetHeight || 340;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) left = rect.right - width;
    if (left < margin) left = margin;
    const openUpward =
      window.innerHeight - rect.bottom - margin < popupHeight &&
      rect.top > popupHeight + margin;
    setPopupStyle({
      position: 'fixed',
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 8 }
        : { top: rect.bottom + 8 }),
      left,
      width,
      zIndex: 10000,
    });
  }

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(updatePosition);
    function onOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !popupRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const days = useMemo(() => {
    const { y, m } = cursor;
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const count = new Date(y, m + 1, 0).getDate();
    const cells: Array<number | null> = Array(lead).fill(null);
    for (let d = 1; d <= count; d += 1) cells.push(d);
    return cells;
  }, [cursor]);

  function shiftMonth(delta: number) {
    setCursor(({ y, m }) => {
      const next = new Date(y, m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  }

  const popup = (
    <div
      ref={popupRef}
      style={popupStyle}
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-950"
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
          {MONTH_NAMES[cursor.m]} {cursor.y}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEK_DAYS.map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="py-1 text-center text-xs font-semibold uppercase text-zinc-400 dark:text-zinc-500"
          >
            {d}
          </div>
        ))}
        {days.map((d, i) => {
          if (d === null) return <div key={`empty-${i}`} />;
          const ymd = toYmd(cursor.y, cursor.m, d);
          const isFuture = Boolean(max) && ymd > (max as string);
          const selected = ymd === value;
          return (
            <button
              key={ymd}
              type="button"
              disabled={isFuture}
              onClick={() => {
                onChange(ymd);
                setOpen(false);
              }}
              className={[
                'h-9 rounded-full text-sm transition-colors',
                selected
                  ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10',
                'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
              ].join(' ')}
            >
              {pad(d)}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
      <span>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setCursor(parseYmd(value || max || ''));
          setOpen((v) => !v);
        }}
        className={[
          'flex h-11 items-center gap-2 rounded-md px-3 text-left outline-none transition-colors focus:ring-4 disabled:opacity-50',
          theme === 'dark'
            ? 'border border-white/10 bg-white/5 text-white/75 hover:bg-white/[0.07] hover:border-white/15 focus:border-violet-400/40 focus:ring-violet-300/20'
            : 'border border-zinc-200 bg-white text-zinc-900 ring-zinc-900/10 hover:bg-zinc-50',
        ].join(' ')}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
        <span className="truncate">
          {value ? formatYmd(value) : 'Selecione a data'}
        </span>
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(popup, document.body)
        : null}
    </div>
  );
}
