'use client';

import { Check, RefreshCw } from 'lucide-react';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { PlatformField } from '../PlatformField';
import type { PlatformIntegrationSettings } from '../types';
import { PlatformCredentialField } from './PlatformCredentialField';

export function PlatformSettingsForm({
  platformId,
  settings,
  onClose,
}: {
  platformId: string;
  settings: PlatformIntegrationSettings;
  onClose: () => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState(settings.WEBHOOK_URL ?? '');
  const [credentials, setCredentials] = useState(settings);
  const api = useClienteApi();
  const { toast } = useToast();
  const rotate = useMutation({
    mutationFn: () =>
      api.post<{ data: PlatformIntegrationSettings }>(
        `/platforms/${encodeURIComponent(platformId)}/integrations/credentials/rotate`,
      ),
    onSuccess: (response) => {
      setCredentials(response.data);
      toast({
        type: 'success',
        title: 'Segredos rotacionados',
        description:
          'Atualize as credenciais na sua integração. Valores anteriores foram invalidados.',
      });
    },
    onError: (error) =>
      toast({
        type: 'error',
        title: 'Não foi possível rotacionar',
        description: error.message,
      }),
  });
  const save = useMutation({
    mutationFn: (value: string | null) =>
      api.put(
        `/platforms/${encodeURIComponent(platformId)}/integrations/WEBHOOK_URL`,
        { value },
      ),
    onSuccess: () => {
      toast({ type: 'success', title: 'Configurações salvas' });
      onClose();
    },
    onError: (error) =>
      toast({
        type: 'error',
        title: 'Não foi possível salvar',
        description: error.message,
      }),
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending || rotate.isPending) return;
        const value = String(
          new FormData(event.currentTarget).get('platform-webhook-url') ?? '',
        ).trim();
        if (value) {
          try {
            const url = new URL(value);
            if (
              !['https:', 'http:'].includes(url.protocol) ||
              url.username ||
              url.password
            )
              throw new Error('invalid');
          } catch {
            toast({
              type: 'error',
              title: 'URL inválida',
              description: 'Informe uma URL HTTP(S) sem usuário ou senha.',
            });
            return;
          }
        }
        save.mutate(value || null);
      }}
    >
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Use estas credenciais na integração da plataforma. Guarde token e
        segredo em local seguro.
      </p>
      <PlatformCredentialField
        label="INBOUND_TOKEN"
        value={credentials.INBOUND_TOKEN}
      />
      <PlatformCredentialField
        label="INBOUND_OPERATIONS"
        value={credentials.INBOUND_OPERATIONS}
      />
      <PlatformCredentialField
        label="WEBHOOK_SECRET"
        value={credentials.WEBHOOK_SECRET}
      />
      <div className="space-y-2">
        <ConfirmActionButton
          type="button"
          variant="outline"
          label="Rotacionar segredos"
          confirmation="Invalidar token e segredo anteriores e gerar novos?"
          confirmContent={
            <>
              <Check size={16} />
              Confirmar rotação
            </>
          }
          disabled={save.isPending || rotate.isPending}
          className="w-52 cursor-pointer disabled:cursor-not-allowed"
          onConfirm={() => rotate.mutate()}
        >
          <RefreshCw size={16} />
          {rotate.isPending ? 'Rotacionando…' : 'Rotacionar segredos'}
        </ConfirmActionButton>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Gera token e segredo, inclusive quando ausentes. Rotação aplicada
          imediatamente; descartar não restaura credenciais anteriores.
        </p>
      </div>
      <PlatformField
        label="WEBHOOK_URL"
        name="platform-webhook-url"
        placeholder="https://minhaloja.com.br/webhooks/simintpay"
        value={webhookUrl}
        onChange={setWebhookUrl}
        disabled={save.isPending || rotate.isPending}
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Deixe vazio para desativar o envio de webhooks.
      </p>
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending || rotate.isPending}
          className="cursor-pointer disabled:cursor-not-allowed"
          onClick={onClose}
        >
          Descartar
        </Button>
        <Button
          type="submit"
          disabled={save.isPending || rotate.isPending}
          className="cursor-pointer border border-violet-500 disabled:cursor-not-allowed"
        >
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
