'use client';

import { useId } from 'react';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { Input } from '@/components/ui/Input';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

type Props = {
  value: string;
  onChange: (value: string) => void;
  theme: 'light' | 'dark';
};

export function BoletoDueDaysField({ value, onChange, theme }: Props) {
  const id = useId();
  const [local, update, flush] = useDebouncedInput(value, onChange);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>
        <FieldLabel info="Deixe vazio para não definir vencimento. Para definir, informe de 1 a 90 dias.">
          Vencimento (dias)
        </FieldLabel>
      </label>
      <Input
        id={id}
        name="vencimentoDias"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        theme={theme}
        variant="navbar"
        placeholder="Sem vencimento"
        value={local}
        onChange={(next) => update(next.replace(/\D/g, '').slice(0, 2))}
        onBlur={() => {
          if (local !== '' && (Number(local) < 1 || Number(local) > 90)) {
            update(String(Math.min(90, Math.max(1, Number(local)))));
          }
          flush();
        }}
      />
    </div>
  );
}
