'use client';

import { cn } from '@/lib/utils';

export function Spinner({
  className,
  size = 20,
}: {
  className?: string;
  size?: number;
}) {
  const style = { width: size, height: size };
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      style={style}
    />
  );
}

export function LoadingOverlay({
  show,
  children,
}: {
  show: boolean;
  children?: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/40 backdrop-blur-md">
      {children ?? <Spinner className="text-foreground" size={24} />}
    </div>
  );
}
