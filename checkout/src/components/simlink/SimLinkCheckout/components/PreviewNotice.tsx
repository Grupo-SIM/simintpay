export function PreviewNotice({ noMethods }: { noMethods: boolean }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-violet-400/30 bg-violet-500/15 p-3 text-center text-sm text-violet-100 lg:col-span-full"
    >
      <p>
        Modo de prévia — explore o checkout com dados fictícios. Pagamentos
        desabilitados.
      </p>
      {noMethods && <p>Nenhuma forma de pagamento habilitada no rascunho.</p>}
    </div>
  );
}
