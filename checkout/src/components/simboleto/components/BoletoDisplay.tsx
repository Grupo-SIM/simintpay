'use client';

import { ExternalLink } from 'lucide-react';
import { CopyRow } from './CopyRow';

export function BoletoDisplay({
  boletoUrl,
  digitableLine,
  barcode,
  dueDate,
}: {
  boletoUrl: string | null;
  digitableLine: string | null;
  barcode: string | null;
  dueDate: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-center text-sm font-semibold text-zinc-100">
        Boleto gerado com sucesso!
      </p>
      {boletoUrl && (
        <a
          href={boletoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 sp2-cta h-auto min-h-[44px] font-medium px-4 py-2.5 text-sm transition "
        >
          <ExternalLink className="h-4 w-4" />
          Abrir / imprimir boleto
        </a>
      )}
      {digitableLine && (
        <CopyRow label="Linha digitável" value={digitableLine} />
      )}
      {barcode && !digitableLine && (
        <CopyRow label="Código de barras" value={barcode} />
      )}
      {dueDate && (
        <p className="text-center text-xs text-zinc-500">
          Vencimento: {dueDate}
        </p>
      )}
      <p className="text-center text-xs text-zinc-500">
        Após o pagamento, a compensação do boleto pode levar até 2 dias úteis.
      </p>
    </div>
  );
}
