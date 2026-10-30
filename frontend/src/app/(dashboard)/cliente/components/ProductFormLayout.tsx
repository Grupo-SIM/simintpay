'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function ProductFormLayout({
  path,
  listTitle,
  title,
  children,
}: {
  path: string;
  listTitle: string;
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-16 [&_button]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
      <nav
        className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        aria-label="Navegação do produto"
      >
        <Link
          href={path}
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          {listTitle}
        </Link>
        <span className="mx-2 text-zinc-400" aria-hidden>
          &gt;
        </span>
        <span className="text-zinc-400">{title}</span>
      </nav>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(path)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
