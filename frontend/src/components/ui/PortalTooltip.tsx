'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { getPopupPosition } from '@/lib/popup-position';
import { createPortal } from 'react-dom';

type Props = {
  /** Gatilho visível (ex.: o valor). Recebe a estilização via `className`. */
  children: ReactNode;
  /** Conteúdo do tooltip, já estilizado (a caixa + seta opcional). */
  content: ReactNode;
  /** Classe aplicada ao gatilho (span). */
  className?: string;
};

/**
 * Tooltip que renderiza seu conteúdo num portal no <body> com `position: fixed`,
 * escapando de QUALQUER ancestral com overflow (tabelas com scroll, `<td>` com
 * overflow-hidden, cards com overflow-hidden, etc.). Aparece acima e alinhado à
 * direita do gatilho, por cima de todo o resto (z alto).
 *
 * Criado porque os tooltips inline (absolute + z-50) das colunas de valores eram
 * cortados pelos overflows do DataTable.
 */
export function PortalTooltip({ children, content, className }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({
    visibility: 'hidden',
  });
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );

  const show = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ left: r.right, top: r.top });
  }, []);

  const hide = useCallback(() => setCoords(null), []);

  useLayoutEffect(() => {
    if (!coords) return;
    const update = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const content = contentRef.current;
      if (anchor && content)
        setPosition(
          getPopupPosition(
            anchor,
            {
              width: document.documentElement.clientWidth,
              height: window.innerHeight,
            },
            content.scrollWidth,
            content.scrollHeight,
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
  }, [coords]);

  return (
    <span
      ref={triggerRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {coords !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            ref={contentRef}
            style={position}
            className="pointer-events-none z-[9999] w-fit max-w-[calc(100vw-16px)] overflow-hidden"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
