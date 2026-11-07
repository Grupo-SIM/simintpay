'use client';

import { useId, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { Dropdown } from './Dropdown';
import { selectPopupClass, selectTriggerClass } from './select-styles';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

type Props = { label: string; required?: boolean } & (
  | {
      value: string;
      options: { value: string; label: string; selectedLabel?: string }[];
      onChange: (value: string) => void;
      search?: undefined;
    }
  | {
      search: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        content: ReactNode;
        selection?: ReactNode;
        placeholder?: string;
        disabled?: boolean;
      };
    }
);

export function CustomSelect(props: Props) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const { label } = props;
  const id = useId();
  if (props.search) {
    const {
      open,
      onOpenChange,
      content,
      selection,
      placeholder = 'Selecione',
      disabled,
    } = props.search;
    return (
      <div className="space-y-1.5">
        <span id={id} className="text-sm text-zinc-900 dark:text-zinc-100">
          {label}
          {props.required && (
            <>
              {' '}
              <span aria-hidden className="text-red-500">
                *
              </span>
            </>
          )}
        </span>
        <Popover modal open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-labelledby={id}
              aria-expanded={open}
              aria-required={props.required}
              disabled={disabled}
              className={selectTriggerClass(dark)}
            >
              <span className="min-w-0 flex-1">
                {selection || (
                  <span className="text-zinc-400 dark:text-white/40">
                    {placeholder}
                  </span>
                )}
              </span>
              <span aria-hidden className="shrink-0 opacity-60">
                ▾
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className={cn(
              selectPopupClass(dark),
              'z-[10001] w-(--radix-popover-trigger-width) p-0 [&_[data-slot=command-input-wrapper]]:h-auto [&_[data-slot=command-input-wrapper]]:p-2 [&_[data-slot=command-input-wrapper]>svg]:hidden [&_[data-slot=command-input]]:h-8 [&_[data-slot=command-input]]:rounded [&_[data-slot=command-input]]:bg-zinc-100 dark:[&_[data-slot=command-input]]:bg-white/5 [&_[data-slot=command-input]]:px-2 [&_[data-slot=command-input]]:py-1.5 [&_[data-slot=command-list]]:max-h-64 [&_[data-slot=command-item]]:rounded-none [&_[data-slot=command-item]]:px-3 [&_[data-slot=command-item]]:py-2',
            )}
          >
            {content}
          </PopoverContent>
        </Popover>
      </div>
    );
  }
  const { value, options, onChange } = props;
  return (
    <Dropdown
      label={label}
      required={props.required}
      value={value}
      options={options}
      onChange={onChange}
      placeholder="Selecione"
    />
  );
}
