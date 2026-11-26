import { formatPercentage } from '@/features/coproduction/coproduction';
import type { Agreements } from '@/features/participations/types';

/** Entradas da plataforma na oferta: somente leitura, sem e-mail. */
export function InheritedList({
  agreements,
  admin,
  platform,
}: {
  agreements: Agreements;
  admin: boolean;
  platform: boolean;
}) {
  if (platform) return null;
  const lines: { key: string; text: string }[] = [
    ...(agreements.aff.inherited?.affiliates ?? []).map((row) => ({
      key: `aff-${row.code}`,
      text: `${row.name} · Afiliado · Produto ${formatPercentage(row.percentageBps)}%`,
    })),
    ...(admin
      ? [
          ...(agreements.margin?.inherited?.coproducers ?? []).map(
            (row, index) => ({
              key: `co-margin-${index}`,
              text: `${row.name} · Coprodutor · SimIntPay ${formatPercentage(row.percentageBps)}%`,
            }),
          ),
          ...(agreements.margin?.inherited?.affiliates ?? []).map((row) => ({
            key: `aff-margin-${row.code}`,
            text: `${row.name} · Afiliado · SimIntPay ${formatPercentage(row.percentageBps)}%`,
          })),
        ]
      : []),
  ];
  if (!lines.length) return null;
  return (
    <section
      aria-label="Herdados da plataforma"
      className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-white/10"
    >
      <h3 className="text-sm font-semibold">
        Herdados da plataforma (somente leitura)
      </h3>
      <ul className="space-y-1 text-sm">
        {lines.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
    </section>
  );
}
