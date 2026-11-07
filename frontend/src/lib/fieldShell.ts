import { cn } from '@/lib/utils';

/** Borda/fundo iguais ao `Input` com `variant="navbar"` (relatório / filtros). */
export function fieldShellClassNames(
  theme: 'light' | 'dark',
  variant: 'default' | 'navbar',
  opts?: { hasError?: boolean; focusWithin?: boolean },
) {
  const { hasError, focusWithin = true } = opts ?? {};
  const focusRing = focusWithin
    ? theme === 'dark'
      ? 'focus-within:border-violet-400/40 focus-within:ring-4 ring-violet-500/20'
      : 'focus-within:ring-4 ring-zinc-900/10'
    : '';

  return cn(
    'flex h-11 items-stretch overflow-hidden rounded-md border outline-none transition-colors',
    theme === 'dark' && variant === 'navbar'
      ? [
          'border-white/10 bg-white/[0.05]',
          'hover:bg-white/[0.07] hover:border-white/15',
          focusRing,
        ]
      : theme === 'dark'
        ? [
            'border-white/10 bg-white/5',
            'hover:bg-white/[0.07] hover:border-white/15',
            focusRing,
          ]
        : ['border-zinc-200 bg-white', focusRing],
    hasError && 'border-red-400',
  );
}

export function fieldDividerClassNames(
  theme: 'light' | 'dark',
  variant: 'default' | 'navbar',
) {
  if (theme === 'dark' && variant === 'navbar') return 'border-white/10';
  if (theme === 'dark') return 'border-white/10';
  return 'border-zinc-200';
}
