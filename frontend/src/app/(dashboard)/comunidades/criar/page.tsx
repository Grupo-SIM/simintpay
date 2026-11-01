'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useToast } from '@/components/ui/Toast';

export default function CriarComunidadePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () =>
          typeof window !== 'undefined'
            ? localStorage.getItem('access_token')
            : null,
      }),
    [],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(endpoints.admin.comunidades.create, {
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comunidades'] });
      void queryClient.invalidateQueries({ queryKey: ['comunidades-all'] });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'platform-taxas'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'plataformas', 'list'],
      });
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['pix-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['links-pagamento'] });
      void queryClient.invalidateQueries({ queryKey: ['links-assinatura'] });
      toast({
        type: 'success',
        title: 'Cliente criado',
        description: 'Cliente SimIntPay criado com sucesso.',
      });
      router.push('/admin/contas?tab=usuarios');
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível criar o cliente.';
      toast({
        type: 'error',
        title: 'Erro ao criar cliente',
        description: message,
      });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-16">
      <nav className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Link
          href="/admin/contas?tab=usuarios"
          className="transition-colors hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          Clientes SimIntPay
        </Link>
        <span className="mx-2 text-zinc-400">&gt;</span>
        <span className="text-zinc-400">Criar cliente</span>
      </nav>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/admin/contas?tab=usuarios')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-emerald-800 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/15"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
          Criar cliente SimIntPay
        </h1>
      </div>

      <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="grid gap-4">
          <Input
            label="Nome do cliente"
            required
            value={name}
            onChange={setName}
            placeholder="Ex: Marketing Raiz"
            theme={fieldTheme}
            variant="navbar"
          />
          <Input
            label="Descrição (opcional)"
            value={description}
            onChange={setDescription}
            placeholder="Descrição do cliente"
            theme={fieldTheme}
            variant="navbar"
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/admin/contas?tab=usuarios')}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-emerald-700 text-white hover:bg-emerald-800"
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Criando...' : 'Criar cliente'}
          </Button>
        </div>
      </section>
    </div>
  );
}
