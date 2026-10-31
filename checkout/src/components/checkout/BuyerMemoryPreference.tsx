'use client';

import type { useBuyerMemory } from '@/hooks/use-buyer-memory';

type Props = ReturnType<typeof useBuyerMemory> & { className?: string };

export function BuyerMemoryPreference({
  remember,
  ready,
  storageError,
  changeRemember,
  className = 'mt-4 space-y-2 text-sm text-[var(--checkout-muted)]',
}: Props) {
  return (
    <div className={className}>
      <p>
        Usamos seus dados para emitir o pagamento e enviar seu acesso. Só os
        guardamos neste navegador se você marcar a opção abaixo.
      </p>
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={remember}
          aria-label="Lembrar meus dados neste navegador"
          disabled={!ready}
          onClick={() => changeRemember(!remember)}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span aria-hidden="true">{remember ? '✓' : ''}</span>
        </button>
        <span>Lembrar meus dados neste navegador</span>
      </div>
      <p>
        Opcional: ao marcar, salvamos neste navegador seu nome, e-mail, CPF/CNPJ
        e telefone para preencher suas próximas compras, até você desmarcar.
        Nada é enviado ao servidor por esta opção. Dados de cartão e endereço
        nunca são salvos. Evite em dispositivos compartilhados. Desmarque para
        apagar os dados salvos.
      </p>
      {storageError && (
        <p role="status">
          Não foi possível atualizar os dados salvos no navegador. Você pode
          continuar a compra normalmente. Para apagar, limpe os dados deste site
          nas configurações do navegador.
        </p>
      )}
    </div>
  );
}
