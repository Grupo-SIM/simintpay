'use client';

import { useState } from 'react';
import { buildDraft, upsertPerson } from './people';
import type {
  Agreements,
  ParticipationsContext,
  ParticipationsDraft,
  PersonDraft,
  SettingsDraft,
} from './types';

/** Rascunho único das pessoas e das configurações gerais; fica no editor para a validação conjunta. */
export function useParticipationsDraft(
  initial: Agreements,
  context: ParticipationsContext,
) {
  const [draft, setDraft] = useState<ParticipationsDraft>(() =>
    buildDraft(initial, context),
  );
  return {
    draft,
    reset: (next: Agreements) => setDraft(buildDraft(next, context)),
    patchSettings: (patch: Partial<SettingsDraft>) =>
      setDraft((previous) => ({
        ...previous,
        settings: { ...previous.settings, ...patch },
      })),
    savePerson: (person: PersonDraft) =>
      setDraft((previous) => upsertPerson(previous, person)),
    removePerson: (id: string) =>
      setDraft((previous) => ({
        ...previous,
        people: previous.people.filter((person) => person.id !== id),
      })),
  };
}

export type ParticipationsDraftState = ReturnType<
  typeof useParticipationsDraft
>;
