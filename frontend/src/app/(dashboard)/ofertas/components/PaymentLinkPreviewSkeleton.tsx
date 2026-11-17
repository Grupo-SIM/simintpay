import { Skeleton } from '@/components/ui/Skeleton';

export function PaymentLinkPreviewSkeleton() {
  return (
    <div
      role="status"
      className="absolute inset-0 grid gap-6 bg-zinc-100 p-6 dark:bg-zinc-950 md:grid-cols-2"
    >
      <span className="sr-only">Carregando prévia do checkout...</span>
      <div className="space-y-6 rounded-2xl border border-zinc-200 p-6 dark:border-white/10">
        <Skeleton className="h-10 w-2/3 bg-zinc-200" />
        <Skeleton className="h-24 w-full bg-zinc-200" />
        <Skeleton className="h-12 w-1/2 bg-zinc-200" />
      </div>
      <div className="space-y-4 rounded-2xl border border-zinc-200 p-6 dark:border-white/10">
        <Skeleton className="h-10 w-1/2 bg-zinc-200" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full bg-zinc-200" />
        ))}
        <Skeleton className="h-24 w-full bg-zinc-200" />
      </div>
    </div>
  );
}
