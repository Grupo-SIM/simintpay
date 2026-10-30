'use client';

import { Info } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type Props = { children: ReactNode; label?: string };

/** Field explanations escape scroll containers and stay within the viewport. */
export function HelpTooltip({ children, label = 'Informação' }: Props) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const pinnedRef = useRef(false);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      setDark(Boolean(triggerRef.current?.closest('.dark')));
      const trigger = triggerRef.current?.getBoundingClientRect();
      const content = contentRef.current?.getBoundingClientRect();
      if (!trigger || !content) return;
      const gap = 8;
      const left = Math.max(
        gap,
        Math.min(
          trigger.left + trigger.width / 2 - content.width / 2,
          window.innerWidth - content.width - gap,
        ),
      );
      const below = trigger.bottom + gap;
      const top =
        below + content.height <= window.innerHeight - gap
          ? below
          : Math.max(gap, trigger.top - content.height - gap);
      setPosition({ left, top });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, children]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      pinnedRef.current = false;
      setOpen(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !triggerRef.current?.contains(event.target as Node) &&
        !contentRef.current?.contains(event.target as Node)
      )
        close();
    };
    document.addEventListener('keydown', keyDown);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  const toggle = () => {
    pinnedRef.current = !pinnedRef.current;
    setOpen(pinnedRef.current);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-300 p-0.5 text-zinc-500 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') {
            hoverRef.current = true;
            setOpen(true);
          }
        }}
        onPointerLeave={() => {
          hoverRef.current = false;
          if (!focusRef.current && !pinnedRef.current) setOpen(false);
        }}
        onFocus={() => {
          focusRef.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          focusRef.current = false;
          if (!hoverRef.current && !pinnedRef.current) setOpen(false);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <span
            ref={contentRef}
            id={id}
            role="tooltip"
            data-theme={dark ? 'dark' : 'light'}
            style={{
              position: 'fixed',
              ...position,
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: 'calc(100vh - 16px)',
            }}
            className="pointer-events-none z-[10000] w-72 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm font-normal normal-case leading-relaxed text-zinc-700 shadow-xl data-[theme=dark]:border-zinc-700 data-[theme=dark]:bg-zinc-900 data-[theme=dark]:text-zinc-200"
          >
            {children}
          </span>,
          document.body,
        )}
    </>
  );
}
