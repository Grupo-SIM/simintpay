'use client';

import { ProductStatusBadge } from '@/components/ui/ProductStatusBadge';
import { PlatformBadges } from '@/components/ui/PlatformBadges';
import { ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import { SUBSCRIPTION_FREQUENCY_LABEL, type LinkAssinaturaRow } from '../types';
import { LinksAssinaturaRowActionsMenu } from './LinksAssinaturaRowActionsMenu';

type Action = 'editar' | 'assinantes' | 'alternar-status' | 'excluir';

type Props = {
  rows: LinkAssinaturaRow[];
  page: number;
  pageSize: number;
  total: number;
  fieldTheme: 'light' | 'dark';
  onPageChange: (page: number) => void;
  onRowAction?: (action: Action, rowId: string) => void;
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: () => void;
};

export function LinksAssinaturaTable({
  rows,
  page,
  pageSize,
  total,
  fieldTheme,
  onPageChange,
  onRowAction,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: Props) {
  return (
    <DataTable
      columns={[
        {
          key: 'code',
          header: 'Código do link',
          className: 'text-left',
          headerClassName: 'text-left',
          defaultWidth: 180,
          render: (row) => (
            <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
              {row.code}
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
          key: 'valor',
          header: 'Valor',
          className: 'text-left',
          headerClassName: 'text-left',
          render: (row) => (
            <span className="text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
              {row.valor.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
            </span>
          ),
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
          key: 'plataformas',
          header: 'Plataformas',
          render: (row) => <PlatformBadges platforms={row.plataformas} />,
        },
        {
          key: 'frequencyType',
          header: 'Frequência',
          render: (row) => (
            <span>{SUBSCRIPTION_FREQUENCY_LABEL[row.frequencyType]}</span>
          ),
        },
        {
          key: 'uses',
          header: 'Usos',
          render: (row) => (
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {row.currentUses}/{row.maxUses ?? 'Ilimitado'}
            </span>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (row) => <ProductStatusBadge status={row.status} />,
        },
        {
          key: 'checkoutLink',
          header: 'Checkout',
          className: 'text-left',
          headerClassName: 'text-left',
          render: (row) => (
            <a
              href={row.checkoutLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-[260px] items-center gap-1.5 truncate text-sm text-emerald-700 hover:underline dark:text-emerald-400"
            >
              <span className="truncate">{row.checkoutLink}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ),
        },
        {
          key: 'actions',
          header: 'Ações',
          render: (row) => (
            <LinksAssinaturaRowActionsMenu
              rowId={row.id}
              isActive={row.isActive}
              fieldTheme={fieldTheme}
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
      minWidth="min-w-[1100px]"
      emptyTitle="Nenhum link encontrado"
      emptyDescription="Crie seu primeiro link de assinatura."
      selectable
      getRowId={(row) => row.id}
      selectedIds={selectedIds}
      onToggleRow={onToggleRow}
      onToggleAll={onToggleAll}
    />
  );
}
