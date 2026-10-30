'use client';

import {
  formatBRL,
  formatTransacaoDescricaoUi,
  cn,
  negativeMoneyClass,
} from '@/lib/utils';

type LinhaTx = {
  id: string;
  createdAt: string;
  descricao: string | null;
  bruto: number;
  liquidezLojista: number;
  parteAdminMasterBruto: number;
  formulaParteAdmin: string;
  taxaFixaTransacao: number;
  taxaCashback: number;
  taxaServico: number;
  lucroTransacao: number;
  formulaLucro: string;
};

export type Plataforma = {
  tag: string;
  userId: string;
  envLiquidez: string;
  envTaxaFixa: string;
  envTaxaCashback: string;
  envTaxaServico: string;
  liquidezLojista: number;
  taxaFixaTransacao: number;
  taxaCashback: number;
  taxaServico: number;
  quantidadeTransacoes: number;
  subtotalBruto: number;
  subtotalParteAdminMaster: number;
  subtotalDeducaoTaxaFixa: number;
  subtotalDeducaoTaxaCashback: number;
  subtotalDeducaoTaxaServico: number;
  subtotalLucro: number;
  transacoes?: LinhaTx[];
};

export type SaqueDiarioItem = {
  ymd: string;
  platformTag: string;
  lucroSaque: number;
};

export type LucroSimpayDetalhe = {
  formula: string;
  valorLiquidoCriterio?: string;
  saquesPorDia?: SaqueDiarioItem[];
  exclusoesDoCalculo?: {
    regra: string;
    quantidadeExcluidas: number;
    exemplos: Array<{
      id: string;
      createdAt: string;
      bruto: number;
      descricao: string | null;
      motivo: string;
    }>;
  };
  periodo: {
    dataInicio: string | null;
    dataFim: string | null;
    fuso: string;
    observacao: string;
  };
  transacoesConsideradas: number;
  lucroSimpayTotal: number;
  plataformas: Plataforma[];
  soloResumoPlataforma?: boolean;
};

export function LucroSimpayDetalhePanel({
  detalhe,
}: {
  detalhe: LucroSimpayDetalhe;
}) {
  return (
    <details
      open
      className="rounded-2xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900/40"
    >
      <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        Detalhamento do lucro Simintpay ({detalhe.transacoesConsideradas}{' '}
        transações → total{' '}
        <span className={negativeMoneyClass(detalhe.lucroSimpayTotal)}>
          {formatBRL(detalhe.lucroSimpayTotal)}
        </span>
        )
      </summary>
      <div className="mt-4 space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
        <p className="rounded-lg bg-zinc-100/80 px-3 py-2 text-xs leading-relaxed dark:bg-zinc-800/60">
          {detalhe.formula}
        </p>
        {detalhe.exclusoesDoCalculo &&
        detalhe.exclusoesDoCalculo.quantidadeExcluidas > 0 ? (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
            <p className="font-medium text-amber-900 dark:text-amber-100">
              Transações fora do cálculo (
              {detalhe.exclusoesDoCalculo.quantidadeExcluidas})
            </p>
            <p className="mt-1 text-amber-900/90 dark:text-amber-200/90">
              {detalhe.exclusoesDoCalculo.regra}
            </p>
            <ul className="mt-2 max-h-40 list-inside list-disc space-y-1 overflow-auto text-amber-900/85 dark:text-amber-200/85">
              {detalhe.exclusoesDoCalculo.exemplos.map((e) => {
                const descUi = formatTransacaoDescricaoUi(e.descricao);
                return (
                  <li key={e.id}>
                    <span className="font-mono text-[10px]">{e.id}</span> ·
                    bruto {formatBRL(e.bruto)} · {e.motivo}
                    {descUi
                      ? ` — ${descUi.slice(0, 80)}${descUi.length > 80 ? '…' : ''}`
                      : ''}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className="space-y-1 text-xs">
          <p>
            <span className="font-medium text-zinc-600 dark:text-zinc-400">
              Período (API):
            </span>{' '}
            {detalhe.periodo.dataInicio ?? '—'} até{' '}
            {detalhe.periodo.dataFim ?? '—'} ({detalhe.periodo.fuso})
          </p>
          <p className="text-amber-800/90 dark:text-amber-200/90">
            {detalhe.periodo.observacao}
          </p>
          {detalhe.valorLiquidoCriterio ? (
            <p className="rounded-md bg-sky-50/90 px-2 py-1.5 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
              <span className="font-medium">Valor líquido (card):</span>{' '}
              {detalhe.valorLiquidoCriterio}
            </p>
          ) : null}
        </div>
        {detalhe.soloResumoPlataforma ? (
          <p className="text-xs text-zinc-500">
            Modo só resumo por plataforma (lista de transações omitida).
          </p>
        ) : null}

        <div className="space-y-6">
          {detalhe.plataformas.map((p) => (
            <div
              key={p.tag}
              className="rounded-xl border border-zinc-200/70 p-3 dark:border-white/10"
            >
              <h3 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">
                {p.tag}
              </h3>
              <div className="mb-2 grid gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                <span>
                  Env: {p.envLiquidez}={p.liquidezLojista}, {p.envTaxaFixa}=
                  {p.taxaFixaTransacao}, {p.envTaxaCashback}={p.taxaCashback}
                </span>
                <span>
                  Transações: {p.quantidadeTransacoes} · Bruto{' '}
                  {formatBRL(p.subtotalBruto)} · Parte master (sobre bruto){' '}
                  {formatBRL(p.subtotalParteAdminMaster)} · (−) taxa fixa total{' '}
                  {formatBRL(p.subtotalDeducaoTaxaFixa)} · (−) cashback total{' '}
                  {formatBRL(p.subtotalDeducaoTaxaCashback)} →{' '}
                  <strong>Subtotal lucro {formatBRL(p.subtotalLucro)}</strong>
                </span>
              </div>
              {p.transacoes && p.transacoes.length > 0 ? (
                <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-100/95 dark:bg-zinc-800/95">
                      <tr>
                        <th className="p-2 font-medium">Data</th>
                        <th className="p-2 font-medium">Bruto</th>
                        <th className="p-2 font-medium">Lucro tx</th>
                        <th className="p-2 font-medium">Fórmulas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.transacoes.map((t) => {
                        const descUi = formatTransacaoDescricaoUi(t.descricao);
                        return (
                          <tr
                            key={t.id}
                            className="border-t border-zinc-100 dark:border-zinc-800"
                          >
                            <td className="whitespace-nowrap p-2 align-top text-zinc-600 dark:text-zinc-400">
                              {new Date(t.createdAt).toLocaleString('pt-BR')}
                              <div className="mt-0.5 max-w-[180px] truncate font-mono text-[10px] text-zinc-400">
                                {t.id}
                              </div>
                            </td>
                            <td className="whitespace-nowrap p-2 align-top">
                              {formatBRL(t.bruto)}
                            </td>
                            <td
                              className={cn(
                                'whitespace-nowrap p-2 align-top font-medium',
                                negativeMoneyClass(t.lucroTransacao),
                              )}
                            >
                              {formatBRL(t.lucroTransacao)}
                            </td>
                            <td className="p-2 align-top text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
                              <div>{t.formulaParteAdmin}</div>
                              <div className="mt-0.5">{t.formulaLucro}</div>
                              {descUi ? (
                                <div className="mt-1 max-h-10 overflow-hidden text-zinc-500">
                                  {descUi}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
