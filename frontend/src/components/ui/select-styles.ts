import { cn } from '@/lib/utils';

export function selectTriggerClass(dark: boolean) {
  return cn(
    'relative flex h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-3 text-left text-sm outline-none transition-colors focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60',
    dark
      ? 'border-white/10 bg-white/5 text-white/75 hover:bg-white/[0.07] hover:border-white/15 focus:border-violet-400/40 focus:ring-violet-300/20'
      : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 focus:ring-zinc-900/10',
  );
}

export function selectPopupClass(dark: boolean) {
  return cn(
    'overflow-hidden rounded-md border shadow-md',
    dark
      ? 'border-white/10 bg-[#0b0b17] text-white'
      : 'border-zinc-200 bg-white text-zinc-900',
  );
}
