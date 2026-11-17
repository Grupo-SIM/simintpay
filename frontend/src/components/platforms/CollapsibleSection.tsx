import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Painel recolhível (fechado por padrão), no mesmo estilo da seção "Entrega" das ofertas. */
export function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <details
      aria-label={title}
      className="group rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-white/5"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </span>
          {description && (
            <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}
