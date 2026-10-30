export function DashboardPageSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Carregando painel"
    >
      <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-white/10" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-24 animate-pulse rounded-2xl bg-zinc-200 dark:bg-white/10"
          />
        ))}
      </div>
      <div className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
        {[0, 1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="my-4 h-8 animate-pulse rounded-lg bg-zinc-200 dark:bg-white/10"
          />
        ))}
      </div>
    </div>
  );
}
