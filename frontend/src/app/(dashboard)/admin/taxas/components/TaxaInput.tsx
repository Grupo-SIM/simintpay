'use client';

import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/Input';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

type Props = ComponentProps<typeof Input> & {
  value: string;
  onChange: (value: string) => void;
};

export function TaxaInput({ value, onChange, onBlur, ...props }: Props) {
  const [local, setLocal, flush] = useDebouncedInput(value, onChange);
  return (
    <Input
      {...props}
      value={local}
      onChange={setLocal}
      onBlur={(event) => {
        flush();
        onBlur?.(event);
      }}
    />
  );
}
