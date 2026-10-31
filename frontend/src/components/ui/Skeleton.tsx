import { cn } from '@/lib/utils';

type SkeletonProps = React.ComponentProps<'div'>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-xl bg-white/10 dark:bg-white/10',
        className,
      )}
      {...props}
    />
  );
}
