import { Handshake } from 'lucide-react';
import {
  affiliationAmountCents,
  affiliationStateLabel,
} from '@/features/affiliates/affiliation';
import type { TransacaoAfiliacao } from '@/features/transacoes/types/transacoes.types';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Afiliação da venda, somente leitura: comissão do afiliado ou comissão paga pelo dono. */
export function AffiliationDetailCard({
  afiliacao,
}: {
  afiliacao: TransacaoAfiliacao;
}) {
  const mine = afiliacao.role === 'AFFILIATE';
  const cents = affiliationAmountCents(afiliacao);
  return (
    <section
      aria-label="Afiliação"
      className="rounded-3xl border border-white/40 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
    >
      <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-4 dark:border-white/5">
        <Handshake className="h-4 w-4 text-zinc-400" />
        <h3 className="px-1 text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-zinc-100">
          Afiliação
        </h3>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            {mine ? 'Sua comissão' : 'Comissão paga ao afiliado'}
          </dt>
          <dd className="text-lg font-semibold">
            {cents == null ? 'Calculada na aprovação' : money(cents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Situação</dt>
          <dd className="text-lg font-semibold">
            {affiliationStateLabel(afiliacao.state)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Origem</dt>
          <dd className="text-lg font-semibold">
            {afiliacao.isRenewal ? 'Renovação' : 'Primeira venda'}
          </dd>
        </div>
        {!mine && afiliacao.affiliateCode && (
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">
              Código do afiliado
            </dt>
            <dd className="font-mono text-lg font-semibold">
              {afiliacao.affiliateCode}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {mine
          ? 'Somente leitura. O valor já integra a sua carteira quando creditado.'
          : 'A comissão já foi descontada do seu líquido nesta venda.'}
      </p>
    </section>
  );
}
