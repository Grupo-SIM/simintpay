import type { HTMLAttributes } from 'react';

export function ScrollArea({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`scrollbar-themed overflow-auto ${className}`} />
  );
}
