export function ReportError({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-300 p-4 text-sm">
      Não foi possível carregar os dados.{' '}
      <button
        type="button"
        className="ml-2 cursor-pointer rounded border border-current px-3 py-1"
        onClick={retry}
      >
        Tentar novamente
      </button>
    </div>
  );
}
