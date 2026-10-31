'use client';

import { FinancialPolicyEditor } from './FinancialPolicyEditor';
import { panel, type Platform } from './types';

export function PlatformRateEditor({ platform }: { platform: Platform }) {
  if (
    platform.coproducao?.readOnly ||
    platform.coproducao?.role === 'COPRODUCER'
  ) {
    return (
      <section className={panel} aria-label="Plataforma compartilhada">
        <h2 className="font-semibold">{platform.name}</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Coprodução · Somente leitura. Configurações, taxas e integrações são
          gerenciadas pelo proprietário. Sua participação é exibida
          separadamente nos recebimentos de coprodução e já integra sua
          carteira.
        </p>
      </section>
    );
  }
  return <FinancialPolicyEditor tag={platform.tag} name={platform.name} />;
}
