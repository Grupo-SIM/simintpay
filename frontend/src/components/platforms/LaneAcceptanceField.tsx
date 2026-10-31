'use client';

const LANES: { id: string; label: string }[] = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `CREDIT_CARD/${i + 1}`,
    label: `Crédito ${i + 1}x`,
  })),
  { id: 'DEBIT_CARD/1', label: 'Débito' },
  { id: 'PIX/1', label: 'Pix' },
  { id: 'BOLETO/1', label: 'Boleto' },
];

export function LaneAcceptanceField({
  disabled,
  onChange,
}: {
  disabled: string[];
  onChange: (disabled: string[]) => void;
}) {
  const off = new Set(disabled);
  return (
    <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">
        Modalidades aceitas
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {LANES.map(({ id, label }) => (
          <label
            key={id}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              name={`accepted-${id}`}
              checked={!off.has(id)}
              onChange={(event) => {
                const next = new Set(off);
                if (event.currentTarget.checked) next.delete(id);
                else next.add(id);
                onChange([...next].sort());
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="text-sm text-zinc-500">
        Modalidades desmarcadas são recusadas nesta plataforma e não entram na
        validação de cobertura do custo da adquirente.
      </p>
    </fieldset>
  );
}
