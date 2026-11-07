import type { ReactNode } from 'react';

export function ProductFormSection({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div
        className={`flex items-center justify-between gap-3${children ? ' mb-4' : ''}`}
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
