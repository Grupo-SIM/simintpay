'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import {
  disableSalePush,
  enableSalePush,
  getSalePushSubscription,
  reconcileSalePushOwner,
  supportsSalePush,
} from '@/lib/sale-push';

export function SalePushControl({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const supported = useSyncExternalStore(
    () => () => {},
    supportsSalePush,
    () => true,
  );

  useEffect(() => {
    let active = true;
    reconcileSalePushOwner(userId)
      .then(() => getSalePushSubscription())
      .then((subscription) => {
        if (active) setEnabled(Boolean(subscription));
      })
      .catch(() => {
        if (active)
          toast({
            type: 'error',
            title: 'Não foi possível consultar notificações',
            description: 'Tente novamente ao ativar notificações.',
          });
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [userId, toast]);

  async function toggle() {
    setBusy(true);
    try {
      if (enabled) await disableSalePush();
      else await enableSalePush(userId);
      setEnabled(!enabled);
      toast({
        type: 'success',
        title: enabled
          ? 'Notificações desativadas neste dispositivo'
          : 'Notificações de venda ativadas',
      });
    } catch (error) {
      toast({
        type: 'error',
        title: 'Não foi possível alterar notificações',
        description:
          error instanceof Error ? error.message : 'Tente novamente.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="cursor-pointer disabled:cursor-not-allowed"
      disabled={busy}
      onClick={toggle}
      title={
        supported
          ? 'Receba vendas aprovadas mesmo com o painel fechado. O navegador e o sistema precisam permitir execução em segundo plano.'
          : 'Navegador incompatível com Web Push'
      }
    >
      {enabled ? <BellOff size={14} /> : <Bell size={14} />}
      <span className="hidden sm:inline">
        {busy
          ? 'Verificando notificações…'
          : enabled
            ? 'Desativar notificações'
            : 'Ativar notificações de venda'}
      </span>
      <span className="sr-only sm:hidden">
        {enabled ? 'Desativar notificações' : 'Ativar notificações de venda'}
      </span>
    </Button>
  );
}
