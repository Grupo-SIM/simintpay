'use client';

import { Button } from '@/components/ui/Button';

export function ProductEditState({
  loading,
  retry,
}: {
  loading: boolean;
  retry: () => void;
}) {
  if (loading)
    return (
      <div
        aria-busy="true"
        aria-label="Carregando produto"
        className="mx-auto w-full max-w-3xl space-y-6"
      >
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200 dark:bg-white/10" />
        <div className="grid gap-4 rounded-2xl border border-zinc-200 p-5 dark:border-white/10 md:grid-cols-2">
          {[0, 1, 2, 3].map((field) => (
            <div
              key={field}
              className="h-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-white/10"
            />
          ))}
        </div>
        <div className="h-11 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-white/10" />
      </div>
    );
  return (
    <div
      role="alert"
      className="mx-auto w-full max-w-3xl rounded-2xl border border-zinc-200 p-6 dark:border-white/10"
    >
      <p className="mb-4">
        Não foi possível carregar o produto. Tente novamente antes de editar.
      </p>
      <Button type="button" variant="outline" onClick={retry}>
        Tentar novamente
      </Button>
    </div>
  );
}
