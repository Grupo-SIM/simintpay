import { Skeleton } from '@/components/ui/Skeleton';

export default function AuthLoading() {
  return (
    <div className="min-h-screen bg-[#070712]">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[520px_1fr]">
        <aside className="px-6 py-8 md:px-10 lg:px-12">
          <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-20">
            <Skeleton className="h-8 w-44 rounded-xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="mt-2 h-11 w-full rounded-2xl" />
          </div>
        </aside>
        <section className="hidden md:block">
          <Skeleton className="h-full w-full rounded-none" />
        </section>
      </div>
    </div>
  );
}
