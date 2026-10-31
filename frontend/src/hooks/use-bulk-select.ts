'use client';

import { useCallback, useState } from 'react';

/** Seleção em massa por id (individual + selecionar/limpar todos de uma lista). */
export function useBulkSelect() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Marca todos os ids passados; se todos já estiverem marcados, desmarca todos. */
  const toggleAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, toggleAll, clear, count: selected.size };
}
