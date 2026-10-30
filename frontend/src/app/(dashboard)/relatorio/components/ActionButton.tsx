'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

type Props = {
  children: ReactNode;
  variant?: 'outline' | 'primary' | 'danger';
  className?: string;
} & React.ComponentProps<'button'>;

export function ActionButton({
  children,
  variant = 'outline',
  className = '',
  ...props
}: Props) {
  const styles = {
    outline:
      'rounded-full border-white/45 bg-white/75 text-zinc-700 hover:-translate-y-0.5 hover:bg-white hover:text-zinc-900 dark:border-white/10 dark:bg-white/10 dark:text-zinc-300 dark:hover:text-white',
    primary:
      'rounded-full border-transparent bg-violet-600 text-white shadow-sm hover:-translate-y-0.5 hover:bg-violet-700 hover:text-white dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500 dark:hover:text-white',
    danger:
      'rounded-full border-rose-200 bg-rose-50 text-rose-600 hover:-translate-y-0.5 hover:bg-rose-100 hover:text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:text-rose-200',
  } as const;

  return (
    <Button
      variant="outline"
      className={`h-10 px-4 text-sm font-medium transition-all duration-300 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </Button>
  );
}
