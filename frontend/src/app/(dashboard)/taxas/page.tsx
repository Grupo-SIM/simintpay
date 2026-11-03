'use client';

import { AppliedFees } from '@/components/platforms/AppliedFees';

export default function TaxasClientePage() {
  return (
    <div className="flex flex-col gap-6 p-1">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Taxas
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Estas são as taxas aplicadas à sua conta. Elas são definidas pela Sim
          Int Pay e não podem ser editadas aqui.
        </p>
      </div>
      <AppliedFees />
    </div>
  );
}
