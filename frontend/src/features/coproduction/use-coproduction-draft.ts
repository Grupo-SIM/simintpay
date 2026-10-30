'use client';

import { useState } from 'react';
import type { Coproducer } from './types';

export function useCoproductionDraft() {
  const [participants, updateParticipants] = useState<Coproducer[]>([]);
  const [explicit, setExplicit] = useState(false);
  return {
    participants,
    setParticipants: (rows: Coproducer[]) => {
      setExplicit(true);
      updateParticipants(rows);
    },
    withBody: <T extends object>(body: T) =>
      explicit || participants.length
        ? {
            ...body,
            coproduction: {
              basis: 'NET' as const,
              version: 0,
              participants: participants.map(({ email, percentageBps }) => ({
                email,
                percentageBps,
              })),
            },
          }
        : body,
  };
}
