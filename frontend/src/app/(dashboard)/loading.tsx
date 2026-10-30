import { Skeleton } from '@/components/ui/Skeleton';

export default function DashboardLoading() {
  return (
    <div className="flex min-h-[calc(100vh-56px)]">
      <aside className="hidden w-20 sm:block" />
      <main className="flex-1 p-5 md:p-6">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
          <Skeleton className="h-20 w-full rounded-3xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
          </div>
          <Skeleton className="h-[360px] w-full rounded-3xl" />
        </div>
      </main>
    </div>
  );
}
