'use client';

import { useCallback, useRef, useState } from 'react';

export function useColumnResize(
  columns: { key: string; defaultWidth?: number }[],
) {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.defaultWidth ?? 150])),
  );

  const dragState = useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const onMouseDown = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      dragState.current = {
        key,
        startX: e.clientX,
        startWidth: widths[key] ?? 150,
      };

      function onMove(ev: MouseEvent) {
        if (!dragState.current) return;
        const { key, startX, startWidth } = dragState.current;
        const delta = ev.clientX - startX;
        const next = Math.max(60, startWidth + delta);
        setWidths((prev) => ({ ...prev, [key]: next }));
      }

      function onUp() {
        dragState.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [widths],
  );

  const missingColumns = columns.filter((column) => !(column.key in widths));
  if (missingColumns.length) {
    setWidths({
      ...widths,
      ...Object.fromEntries(
        missingColumns.map((column) => [
          column.key,
          column.defaultWidth ?? 150,
        ]),
      ),
    });
  }

  return { widths, onMouseDown };
}
