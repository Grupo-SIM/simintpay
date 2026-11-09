'use client';

import { FinancialPolicyEditor } from './FinancialPolicyEditor';
import { panel, type Platform } from './types';

const formatPercentage = (bps: number) =>
  `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export function PlatformRateEditor({ platform }: { platform: Platform }) {
  const bps = platform.coproducao?.myPercentageBps;
  const percentage = bps ? formatPercentage(bps) : null;
  if (
    platform.coproducao?.readOnly ||
    platform.coproducao?.role === 'COPRODUCER'
  ) {
    return (
      <section className={panel} aria-label="Plataforma compartilhada">
        <h2 className="font-semibold">{platform.name}</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {percentage === null
            ? 'Coprodução, somente leitura.'
            : `Coprodução de ${percentage}, somente leitura.`}
        </p>
      </section>
    );
  }
  return (
    <FinancialPolicyEditor
      tag={platform.tag}
      withdrawalFees={platform.withdrawalFees}
    />
  );
}
