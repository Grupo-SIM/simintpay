'use client';

import { useModalHistory } from '@/hooks/use-modal-history';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import type { Coproducer } from '@/features/coproduction/types';
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <CoproductionDialogContent
        description="Defina os coprodutores antes de criar o produto. As participações serão gravadas junto com ele."
        onClose={close}
      >
        <CoproductionForm
          initial={{ basis: 'NET', version: 0, participants }}
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
