'use client';

import { useState } from 'react';
import { formatPercentage } from './coproduction';
import type { CoproducerDraft, Coproduction } from './types';

type Mode = 'OWN' | 'INHERIT';

const rowsFrom = (agreement: Coproduction): CoproducerDraft[] =>
  agreement.participants.map((row, i) => ({
    id: String(i),
    email: row.email,
    name: row.name,
    percentage: formatPercentage(row.percentageBps),
  }));

/** Rascunho local da co-produção; fica no dono do diálogo para a validação conjunta enxergá-lo. */
export function useCoproductionRows(
  initial: Coproduction,
  allowInheritance: boolean,
) {
  const modeFrom = (agreement: Coproduction): Mode =>
    allowInheritance ? (agreement.mode ?? 'OWN') : 'OWN';
  const [rows, setRows] = useState<CoproducerDraft[]>(() => rowsFrom(initial));
  const [mode, setMode] = useState<Mode>(() => modeFrom(initial));
  return {
    rows,
    mode,
    setRows,
    setMode,
    reset: (next: Coproduction) => {
      setRows(rowsFrom(next));
      setMode(modeFrom(next));
    },
  };
}

export type CoproductionRowsDraft = ReturnType<typeof useCoproductionRows>;
