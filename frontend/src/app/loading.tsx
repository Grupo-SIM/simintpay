import { Skeleton } from '@/components/ui/Skeleton';

export default function AppLoading() {
  return (
    <div className="min-h-screen bg-[#070712] px-6 py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <Skeleton className="h-12 w-56 rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-36 w-full rounded-3xl" />
          <Skeleton className="h-36 w-full rounded-3xl" />
          <Skeleton className="h-36 w-full rounded-3xl" />
        </div>
        <Skeleton className="h-[360px] w-full rounded-3xl" />
      </div>
    </div>
  );
}
