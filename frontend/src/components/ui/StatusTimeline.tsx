import type { ReactNode } from 'react';

export type TimelineItem = {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
};

export function StatusTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              {items.length - idx}
            </div>
            {idx < items.length - 1 ? (
              <div className="mt-2 h-full w-px bg-zinc-200" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {item.title}
                </div>
                {item.description ? (
                  <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                    {item.description}
                  </div>
                ) : null}
              </div>
              {item.right ? (
                <div className="shrink-0 text-sm text-zinc-600">
                  {item.right}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
