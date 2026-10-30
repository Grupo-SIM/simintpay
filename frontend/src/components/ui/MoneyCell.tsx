/**
 * Célula monetária de tabela.
 * Valor zero (ou ausente/inválido) vira "-" em vez de "R$ 0,00", para a linha
 * não competir visualmente com os valores que realmente importam.
 */
export function MoneyCell({
  value,
  className,
}: {
  value: number | string | undefined | null;
  className?: string;
}) {
  const v = Number(value ?? 0);
  if (!Number.isFinite(v) || v === 0) {
    return <span className="text-sm text-zinc-400">-</span>;
  }
  return (
    <span className={className}>
      {v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
    </span>
  );
}
