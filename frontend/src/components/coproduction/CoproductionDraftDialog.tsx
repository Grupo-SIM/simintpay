'use client';

import { useModalHistory } from '@/hooks/use-modal-history';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import { ParticipationTotals } from '@/components/participations/ParticipationTotals';
import type { Coproducer } from '@/features/coproduction/types';
import { useCoproductionRows } from '@/features/coproduction/use-coproduction-rows';
import {
  coproducersFromRows,
  jointTotal,
} from '@/features/participations/joint';
import { CoproductionDialogContent, CoproductionForm } from './components';

export function CoproductionDraftDialog({
  participants,
  onChange,
  onClose,
}: {
  participants: Coproducer[];
  onChange: (participants: Coproducer[]) => void;
  onClose: () => void;
}) {
  const close = useModalHistory({
    isOpen: true,
    onClose,
    urlKey: 'coproduction-draft',
  });
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const initial = { basis: 'NET' as const, version: 0, participants };
  const draft = useCoproductionRows(initial, false);
  const joint = jointTotal({
    coproducers: coproducersFromRows(draft.rows),
    coproducerLevel: 'offer',
    affiliates: [],
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <CoproductionDialogContent
        title="Participações"
        description="Defina os coprodutores antes de criar a oferta. Os afiliados ficam disponíveis depois que ela for criada."
        onClose={close}
        toolbar={<ParticipationTotals result={joint} showAffiliate={false} />}
      >
        <CoproductionForm
          initial={initial}
          draft={draft}
          pending={false}
          blocked={false}
          ownerEmail={!user?.isAdmin ? user?.email : undefined}
          saveLabel="Aplicar coprodutores"
          onClose={close}
          onSave={(rows) => {
            onChange(rows);
            toast({
              type: 'info',
              title: 'Coprodutores definidos',
              description: 'Salve o produto para gravar as participações.',
            });
            close();
          }}
        />
      </CoproductionDialogContent>
    </Dialog>
  );
}
