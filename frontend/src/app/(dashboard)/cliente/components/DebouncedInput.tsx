'use client';

import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/Input';
import { formatCurrencyInput } from '../_shared';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

type Props = Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

export function DebouncedInput({ value, onChange, onBlur, ...props }: Props) {
  const [local, update, flush] = useDebouncedInput(value, onChange);
  return (
    <Input
      {...props}
      type={props.type ?? 'text'}
      name={
        props.name ??
        props.label
          ?.normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
      }
      value={local}
      onChange={(next) =>
        update(props.inputMode === 'decimal' ? formatCurrencyInput(next) : next)
      }
      onBlur={(event) => {
        flush();
        onBlur?.(event);
      }}
    />
  );
}
