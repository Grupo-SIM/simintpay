import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CoproductionButton } from '../CoproductionButton';
import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { createApiClient } from '@/services/api/api.client';
import type { CoproductionProduct } from '@/features/coproduction/types';

export function CoproductionCreateHarness({
  kind,
}: {
  kind: CoproductionProduct;
}) {
  const draft = useCoproductionDraft();
  const [state, setState] = useState('');
  const api = createApiClient({ baseUrl: '/api' });
  return (
    <>
      <CoproductionButton
        product={kind}
        draft={draft.participants}
        onDraftChange={draft.setParticipants}
        disabled={state === 'pending'}
      />
      <Button
        disabled={state === 'pending'}
        onClick={async () => {
          setState('pending');
          try {
            await api.post(
              kind === 'planos-pix' ? '/payments/pix-plan' : `/${kind}`,
              draft.withBody({ nome: 'Produto teste', preco: 100 }),
            );
            setState('success');
          } catch {
            setState('error');
          }
        }}
      >
        Salvar produto
      </Button>
      {state === 'error' && <p role="alert">Falha ao criar produto</p>}
      {state === 'success' && <p>Produto criado</p>}
    </>
  );
}
