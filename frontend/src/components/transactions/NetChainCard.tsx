import { ArrowDown, Link2 } from 'lucide-react';
import { ownerSplit } from '@/features/transacoes/participations';
import type { TransacaoDetail } from '@/features/transacoes/types/transacoes.types';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Step({
  label,
  value,
  sign,
}: {
  label: string;
  value: string;
  sign?: '−' | '=';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-zinc-600 dark:text-zinc-300">
        {sign && (
          <span className="mr-2 inline-block w-3 text-zinc-400">{sign}</span>
        )}
        {label}
      </span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}

/**
 * Cadeia bruto → taxas → líquido → parte do usuário. O líquido da venda aparece apagado e rotulado
 * como base de cálculo, para o participante não o confundir com o que ele recebe; o destaque fica
 * na parte dele. Só para quem tem coprodução ou afiliação na venda.
 */
export function NetChainCard({
  detail,
  grossCents,
}: {
  detail: Pick<TransacaoDetail, 'coproducao' | 'afiliacao' | 'order'>;
  grossCents: number;
}) {
  const co = detail.coproducao;
  const affiliation = detail.afiliacao;
  const net = Math.round(Number(detail.order?.total_liquid ?? 0) * 100);
  if ((!co && !affiliation) || net <= 0) return null;

  const owner = co?.role === 'OWNER' || affiliation?.role === 'OWNER';
  const split = owner
    ? ownerSplit({
        netAmount: detail.order?.total_liquid,
        coproducao: co,
        afiliacao: affiliation,
      })
    : null;
  const mine = owner
    ? (split?.remainingCents ?? null)
    : ((co?.role === 'COPRODUCER' ? co.myAmountCents : null) ??
      affiliation?.myAmountCents ??
      null);
  const fees = Math.max(0, grossCents - net);

  return (
    <section
      aria-label="Do bruto à sua parte"
      className="rounded-3xl border border-white/40 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
    >
      <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-4 dark:border-white/5">
        <Link2 className="h-4 w-4 text-zinc-400" />
        <h3 className="px-1 text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-zinc-100">
          Do total da venda à sua parte
        </h3>
      </div>

      <div className="flex flex-col gap-2">
        <Step label="Total da venda" value={money(grossCents)} />
        <Step sign="−" label="Taxas" value={money(fees)} />

        <div className="my-1 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 px-4 py-3 dark:border-white/15 dark:bg-white/[0.03]">
          <div className="flex items-baseline justify-between gap-4 text-sm text-zinc-500 dark:text-zinc-400">
            <span>
              <span className="mr-2 inline-block w-3 text-zinc-400">=</span>
              Líquido da venda
            </span>
            <span className="tabular-nums">{money(net)}</span>
          </div>
          <p className="mt-1 pl-5 text-xs text-zinc-500 dark:text-zinc-400">
            {owner
              ? 'Base de cálculo da divisão. Ainda não desconta coprodutores e afiliado.'
              : 'Base de cálculo, não é o seu ganho. Pertence ao dono da venda; a sua participação é só uma parte dele.'}
          </p>
        </div>

        {owner && split && (
          <>
            {split.coproducersCents != null && split.coproducersCents > 0 && (
              <Step
                sign="−"
                label="Pago a coprodutores"
                value={money(split.coproducersCents)}
              />
            )}
            {split.affiliateCents > 0 && (
              <Step
                sign="−"
                label="Comissão de afiliado"
                value={money(split.affiliateCents)}
              />
            )}
          </>
        )}

        <div className="mt-1 flex items-center justify-between gap-4 rounded-2xl bg-violet-50 px-4 py-3 dark:bg-violet-500/10">
          <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            <ArrowDown className="h-4 w-4" />
            {owner ? 'Fica com você' : 'Sua participação'}
          </span>
          <span className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300">
            {mine == null ? 'Calculada na aprovação' : money(mine)}
          </span>
        </div>
        {!owner && mine != null && (
          <p className="text-right text-xs text-zinc-500 dark:text-zinc-400">
            {((mine / net) * 100).toLocaleString('pt-BR', {
              maximumFractionDigits: 1,
            })}
            % do líquido da venda
          </p>
        )}
      </div>
    </section>
  );
}
