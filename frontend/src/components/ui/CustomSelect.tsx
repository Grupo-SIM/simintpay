'use client';

import { useId, type ReactNode } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select-radix';

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
        <span id={id} className="text-sm font-medium">
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
              className="flex h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-1 text-left text-sm disabled:cursor-not-allowed dark:border-white/10 dark:bg-black/30"
            >
              <span className="min-w-0">
                {selection || (
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {placeholder}
                  </span>
                )}
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="z-[10001] w-[min(28rem,calc(100vw-3rem))] p-0"
          >
            {content}
          </PopoverContent>
        </Popover>
      </div>
    );
  }
  const { value, options, onChange } = props;
  return (
    <div className="space-y-1.5">
      <span id={id} className="text-sm font-medium">
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
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-labelledby={id}
          aria-required={props.required}
          className="w-full cursor-pointer"
        >
          <SelectValue placeholder="Selecione">
            {options.find((option) => option.value === value)?.selectedLabel ??
              options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              className="cursor-pointer"
              key={option.value}
              value={option.value}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
