'use client';

import { ProductStatusBadge } from '@/components/ui/ProductStatusBadge';
import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import type { LinkPagamentoRow } from '../types';
import { LinksPagamentoRowActionsMenu } from './LinksPagamentoRowActionsMenu';
import { PriceCell } from './PriceCell';

type Action = 'editar' | 'excluir' | 'toggle';

type Props = {
  rows: LinkPagamentoRow[];
  page: number;
  pageSize: number;
  total: number;
  fieldTheme: 'light' | 'dark';
  onPageChange: (page: number) => void;
  onRowAction?: (action: Action, rowId: string) => void;
  onPriceChange?: (id: string, valor: number) => void;
  savingPriceId?: string | null;
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: () => void;
};

export function LinksPagamentoTable({
  rows,
  page,
  pageSize,
  total,
  fieldTheme,
  onPageChange,
  onRowAction,
  onPriceChange,
  savingPriceId,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: Props) {
  return (
    <DataTable
      columns={[
        {
          key: 'id',
          header: 'ID',
          render: (row) => (
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {row.id}
            </span>
          ),
        },
        {
          key: 'titulo',
          header: 'Título',
          className: 'text-left',
          headerClassName: 'text-left',
          render: (row) => (
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {row.titulo}
            </span>
          ),
        },
        {
          key: 'link',
          header: 'Link',
          className: 'text-left',
          headerClassName: 'text-left',
          render: (row) => (
            <a
              href={row.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-[380px] items-center gap-1.5 truncate text-sm text-emerald-700 hover:underline dark:text-emerald-400"
            >
              <span className="truncate">{row.link}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ),
        },
        {
          key: 'plataformas',
          header: 'Plataformas',
          render: (row) => <PlatformBadges platforms={row.plataformas} />,
        },
        {
          key: 'valor',
          header: 'Preço',
          className: 'text-left',
          headerClassName: 'text-left',
          render: (row) => (
            <PriceCell
              value={row.valor}
              saving={savingPriceId === row.id}
              onSave={(valor) => onPriceChange?.(row.id, valor)}
            />
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (row) => <ProductStatusBadge status={row.status} />,
        },
        {
          key: 'criadoPor',
          header: 'Criado por',
          className: 'text-left',
          headerClassName: 'text-left',
          render: (row) => (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-zinc-700 dark:text-zinc-200">
                {row.criadoPor}
              </span>
              {row.criadoPorEmail && (
                <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                  {row.criadoPorEmail}
                </span>
              )}
            </div>
          ),
        },
        {
          key: 'cpfDono',
          header: 'CPF Dono',
          render: (row) =>
            row.cpfDono ? (
              <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                {row.cpfDono}
              </span>
            ) : (
              <span className="text-zinc-400">—</span>
            ),
        },
        {
          key: 'actions',
          header: 'Ações',
          render: (row) => (
            <LinksPagamentoRowActionsMenu
              rowId={row.id}
              fieldTheme={fieldTheme}
              ativo={row.status === 'Ativo'}
              onAction={onRowAction}
            />
          ),
        },
      ]}
      rows={rows}
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
      minWidth="min-w-[1160px]"
      emptyTitle="Nenhum link encontrado"
      emptyDescription="Ajuste os filtros e pesquise novamente."
      selectable
      getRowId={(row) => row.id}
      selectedIds={selectedIds}
      onToggleRow={onToggleRow}
      onToggleAll={onToggleAll}
    />
  );
}
