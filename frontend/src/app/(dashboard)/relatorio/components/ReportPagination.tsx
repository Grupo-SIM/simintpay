export function ReportPagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>
        {total} resultados · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        {[
          { label: 'Anterior', target: page - 1, disabled: page <= 1 },
          { label: 'Próxima', target: page + 1, disabled: page >= pages },
        ].map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={() => onChange(action.target)}
            className="cursor-pointer rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
