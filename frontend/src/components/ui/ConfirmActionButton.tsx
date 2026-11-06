'use client';

import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { getPopupPosition } from '@/lib/popup-position';

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
  const tooltip = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<CSSProperties>({
    visibility: 'hidden',
  });
  useEffect(() => {
    if (!confirming) return;
    const timeout = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [confirming]);
  useLayoutEffect(() => {
    if (!confirming) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const content = tooltip.current;
      if (rect && content)
        setPosition(
          getPopupPosition(
            rect,
            {
              width: document.documentElement.clientWidth,
              height: window.innerHeight,
            },
            content.offsetWidth,
            content.offsetHeight,
            'up',
            'end',
          ),
        );
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [confirming]);
  return (
    <>
      <Button
        {...props}
        ref={trigger}
        aria-label={confirming ? `Confirmar ${label.toLowerCase()}` : label}
        title={confirming ? undefined : label}
        aria-describedby={confirming ? id : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setConfirming(false);
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
      {confirming &&
        createPortal(
          <span
            ref={tooltip}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[9999] w-52 max-w-[calc(100vw-16px)] rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-700 shadow-lg dark:border-white/20 dark:bg-zinc-900 dark:text-zinc-200"
            style={position}
          >
            {confirmation}
          </span>,
          document.body,
        )}
    </>
  );
}
