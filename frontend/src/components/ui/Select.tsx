'use client';

import { useState, type ComponentProps } from 'react';
import { useTheme } from 'next-themes';
import { Dropdown } from './Dropdown';

type Props = ComponentProps<typeof Dropdown> & {
  defaultValue?: string;
  name?: string;
};

export function Select({
  defaultValue,
  name,
  value,
  onChange,
  theme,
  ...props
}: Props) {
  const { resolvedTheme } = useTheme();
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? (props.placeholder ? '' : (props.options[0]?.value ?? '')),
  );
  const selectedValue = value ?? internalValue;

  return (
    <>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={selectedValue}
          disabled={props.disabled}
        />
      ) : null}
      <Dropdown
        {...props}
        theme={theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')}
        value={selectedValue}
        onChange={(nextValue) => {
          setInternalValue(nextValue);
          onChange?.(nextValue);
        }}
      />
    </>
  );
}
