'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { personChips } from '@/features/participations/people';
import type { PersonDraft } from '@/features/participations/types';
import { PersonRow } from './PersonRow';

export function PeopleList({
  people,
  defaults,
  admin,
  disabled,
  onAdd,
  onEdit,
  onRemove,
}: {
  people: PersonDraft[];
  defaults: { affiliate?: string; margin?: string };
  admin: boolean;
  disabled: boolean;
  onAdd: () => void;
  onEdit: (person: PersonDraft) => void;
  onRemove: (person: PersonDraft) => void;
}) {
  return (
    <section aria-label="Pessoas" className="space-y-3">
      <ScrollArea className="max-h-[40vh]">
        {people.length ? (
          <ul className="space-y-2">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                name={person.name}
                email={person.email}
                chips={personChips(person, defaults, admin)}
                disabled={disabled}
                onEdit={() => onEdit(person)}
                onRemove={() => onRemove(person)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-white/20 dark:text-zinc-400">
            Sem participações. O proprietário recebe 100% do líquido.
          </p>
        )}
      </ScrollArea>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full cursor-pointer rounded-xl border-[#7c3aed]/30 bg-transparent text-[#7c3aed] hover:bg-[#7c3aed]/10 disabled:cursor-not-allowed dark:bg-transparent dark:text-[#a78bfa] dark:hover:bg-[#7c3aed]/10"
        disabled={disabled}
        onClick={onAdd}
      >
        <Plus className="h-4 w-4" />
        Adicionar pessoa
      </Button>
    </section>
  );
}
