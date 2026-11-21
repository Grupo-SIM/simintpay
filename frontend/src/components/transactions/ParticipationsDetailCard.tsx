import { HandCoins } from 'lucide-react';
import {
  coproductionStateLabel,
  ownerSplit,
} from '@/features/transacoes/participations';
import type { TransacaoDetail } from '@/features/transacoes/types/transacoes.types';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

/**
 * Coprodução da venda, ao lado do card de afiliação. O dono vê a divisão do líquido (coprodutores,
 * afiliado e o que restou); o coprodutor vê somente a própria parte.
 */
export function ParticipationsDetailCard({
  detail,
}: {
  detail: Pick<TransacaoDetail, 'coproducao' | 'afiliacao' | 'order'>;
}) {
  const co = detail.coproducao;
  if (!co) return null;
  const mine = co.role === 'COPRODUCER';
  const split = mine
    ? null
    : ownerSplit({
        netAmount: detail.order?.total_liquid,
        coproducao: co,
        afiliacao: detail.afiliacao,
      });
  return (
    <section
      aria-label="Coprodução"
      className="rounded-3xl border border-white/40 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
    >
      <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-4 dark:border-white/5">
        <HandCoins className="h-4 w-4 text-zinc-400" />
        <h3 className="px-1 text-sm font-bold uppercase tracking-widest text-zinc-900 dark:text-zinc-100">
          Coprodução
        </h3>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {mine ? (
          <Item
            label="Sua parte"
            value={
              co.myAmountCents == null
                ? 'Calculada na aprovação'
                : money(co.myAmountCents)
            }
          />
        ) : (
          <>
            {split && (
              <>
                <Item
                  label="Pago a coprodutores"
                  value={
                    split.coproducersCents == null
                      ? 'Calculado na aprovação'
                      : money(split.coproducersCents)
                  }
                />
                {split.affiliateCents > 0 && (
                  <Item
                    label="Comissão de afiliado"
                    value={money(split.affiliateCents)}
                  />
                )}
                <Item
                  label="Restou para você"
                  value={money(split.remainingCents)}
                />
              </>
            )}
          </>
        )}
        <Item label="Situação" value={coproductionStateLabel(co.state)} />
      </dl>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {mine
          ? 'Somente leitura. O valor já integra a sua carteira quando creditado.'
          : 'Líquido da venda menos coprodutores e afiliado.'}
      </p>
    </section>
  );
}
