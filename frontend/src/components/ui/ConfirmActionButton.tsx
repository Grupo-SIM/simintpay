'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

type Props = Omit<ComponentProps<typeof Button>, 'onClick' | 'aria-label'> & {
  label: string;
  confirmation: string;
  confirmContent: ReactNode;
  onConfirm: () => void;
};

/** Permanent actions confirm in an anchored portal, preserving trigger geometry. */
export function ConfirmActionButton({
  label,
  confirmation,
  confirmContent,
  onConfirm,
  children,
  ...props
}: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const open = confirming || hovered;
  useEffect(() => {
    if (!confirming) return;
    const timeout = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [confirming]);
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          left: Math.max(
            8,
            Math.min(window.innerWidth - 216, rect.right - 208),
          ),
          top: Math.max(8, rect.top - 64),
        });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);
  return (
    <>
      <Button
        {...props}
        ref={trigger}
        aria-label={confirming ? `Confirmar ${label.toLowerCase()}` : label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setConfirming(false);
            setHovered(false);
          }
        }}
        onClick={() => {
          if (confirming) {
            setConfirming(false);
            onConfirm();
          } else setConfirming(true);
        }}
      >
        {confirming ? confirmContent : children}
      </Button>
      {open &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[9999] w-52 rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-700 shadow-lg dark:border-white/20 dark:bg-zinc-900 dark:text-zinc-200"
            style={position}
          >
            {confirming ? confirmation : label}
          </span>,
          document.body,
        )}
    </>
  );
}
