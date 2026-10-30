'use client';

import type { ComponentProps } from 'react';
import { useTheme } from 'next-themes';
import { Input } from '@/components/ui/Input';
import { useDebouncedInput } from '@/hooks/use-debounced-input';

export function ChargeInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [local, setLocal, flush] = useDebouncedInput(value, onValueChange);
  return (
    <Input
      {...props}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      variant="navbar"
      value={local}
      onChange={setLocal}
      onBlur={flush}
      className="w-full"
    />
  );
}
