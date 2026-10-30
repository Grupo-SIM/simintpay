'use client';

import { useTheme } from 'next-themes';
import { SingleDatePickerField } from '@/app/(dashboard)/links-pagamento/components/SingleDatePickerField';

export function ChargeDateField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <div
      role="group"
      aria-label={label}
      className="relative [&_button]:cursor-pointer"
    >
      <SingleDatePickerField
        label={label}
        required={required}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        value={value ? new Date(`${value}T12:00:00`) : null}
        onChange={(date) =>
          onChange(
            date
              ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
              : '',
          )
        }
      />
    </div>
  );
}
