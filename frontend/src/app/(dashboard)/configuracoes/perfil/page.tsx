'use client';

import { useState, FormEvent } from 'react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { Settings, UserCircle, Save, Key, Lock } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';

function makeApi() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

function formatDocument(cpf?: string | null, cnpj?: string | null): string {
  const digits = (cpf ?? cnpj ?? '').replace(/\D/g, '');
  if (digits.length === 11)
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14)
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    );
  return cpf ?? cnpj ?? '—';
}

function formatDocumentInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export default function MeuPerfilPage() {
  const { toast } = useToast();
  const { user, loading } = useCurrentUser();

  const [documentInput, setDocumentInput] = useState('');
  const [documentLoading, setDocumentLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const hasDocument = Boolean(
    ((user?.cpf ?? '') + (user?.cnpj ?? '')).replace(/\D/g, ''),
  );
  const documentDigits = documentInput.replace(/\D/g, '');
  const documentValid =
    documentDigits.length === 11 || documentDigits.length === 14;

  async function handleDocumentSubmit(e: FormEvent) {
    e.preventDefault();
    if (!documentValid || documentLoading) return;
    setDocumentLoading(true);
    try {
      await makeApi().put(endpoints.configuracoes.documento, {
        documento: documentDigits,
      });
      toast({
        type: 'success',
        title: 'Documento cadastrado',
        description: 'Seu CPF/CNPJ foi salvo com sucesso.',
      });
      // Recarrega para o useCurrentUser refletir o documento salvo
      setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      const msg =
        (err as { message?: string })?.message ?? 'Erro ao salvar documento.';
      toast({ type: 'error', title: 'Erro', description: msg });
    } finally {
      setDocumentLoading(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'As senhas não coincidem.',
      });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'A nova senha deve ter pelo menos 6 caracteres.',
      });
      return;
    }
    setPasswordLoading(true);
    try {
      await makeApi().put(endpoints.configuracoes.senha, {
        currentPassword,
        newPassword,
      });
      toast({
        type: 'success',
        title: 'Senha alterada',
        description: 'Sua senha foi atualizada com sucesso.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg =
        (err as { message?: string })?.message ?? 'Erro ao alterar senha.';
      toast({ type: 'error', title: 'Erro', description: msg });
    } finally {
      setPasswordLoading(false);
    }
  }

  const inputClass =
    'h-11 w-full rounded-xl border border-zinc-200 bg-white/50 px-4 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-zinc-950/20 dark:text-zinc-100 dark:focus:border-violet-400';
  const readOnlyClass =
    'h-11 w-full cursor-not-allowed rounded-xl border border-zinc-200 bg-zinc-100/70 px-4 text-sm text-zinc-600 outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400';
  const labelClass =
    'block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5 ml-1';

  return (
    <div className="relative flex flex-1 flex-col items-center py-8">
      <div className="pointer-events-none fixed left-1/4 top-0 z-0 h-[500px] w-[500px] rounded-full bg-violet-500/5 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-0 right-1/4 z-0 h-[400px] w-[400px] rounded-full bg-blue-500/5 blur-[100px]" />

      <div className="relative z-10 flex w-full max-w-2xl flex-col gap-10">
        <header className="flex flex-col gap-2 px-4">
          <div className="flex items-center gap-3 text-violet-600 dark:text-violet-400">
            <Settings size={28} />
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Configurações
            </h1>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Dados da sua conta e segurança. Os dados cadastrais não podem ser
            alterados aqui.
          </p>
        </header>

        <div className="grid gap-8">
          {/* Dados da conta (read-only) */}
          <section className="rounded-[2rem] border border-white/40 bg-white/70 p-8 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.15)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5">
            <div className="mb-8 flex items-center gap-3 border-b border-zinc-100 pb-6 dark:border-white/5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                <UserCircle size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Dados da Conta
                </h2>
                <p className="text-xs text-zinc-500">
                  Informações cadastradas (somente leitura).
                </p>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-zinc-500">Carregando dados...</p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className={labelClass}>Nome</label>
                  <input
                    type="text"
                    value={user?.name ?? '—'}
                    readOnly
                    disabled
                    className={readOnlyClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>E-mail</label>
                  <input
                    type="text"
                    value={user?.email ?? '—'}
                    readOnly
                    disabled
                    className={readOnlyClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>CPF/CNPJ</label>
                  {hasDocument ? (
                    <input
                      type="text"
                      value={formatDocument(user?.cpf, user?.cnpj)}
                      readOnly
                      disabled
                      className={readOnlyClass}
                    />
                  ) : (
                    <form
                      onSubmit={handleDocumentSubmit}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="000.000.000-00 ou 00.000.000/0000-00"
                        value={documentInput}
                        onChange={(e) =>
                          setDocumentInput(formatDocumentInput(e.target.value))
                        }
                        disabled={documentLoading}
                        className={inputClass}
                      />
                      <button
                        type="submit"
                        disabled={!documentValid || documentLoading}
                        className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white shadow-lg shadow-violet-500/25 transition-all hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save size={16} />
                        {documentLoading ? 'Salvando...' : 'Salvar'}
                      </button>
                    </form>
                  )}
                  {!hasDocument && !loading ? (
                    <p className="ml-1 mt-1.5 text-[11px] text-zinc-500">
                      Cadastre seu CPF ou CNPJ para receber vendas e solicitar
                      saques. Não pode ser alterado depois.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          {/* Alterar senha */}
          <section className="group rounded-[2rem] border border-white/40 bg-white/70 p-8 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.15)] backdrop-blur-2xl transition-all hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/[0.08]">
            <div className="mb-8 flex items-center gap-3 border-b border-zinc-100 pb-6 dark:border-white/5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                <Key size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Alterar Senha
                </h2>
                <p className="text-xs text-zinc-500">
                  Recomendamos uma senha forte com pelo menos 6 caracteres.
                </p>
              </div>
            </div>

            <form
              onSubmit={handlePasswordSubmit}
              className="flex flex-col gap-6"
            >
              <div>
                <label className={labelClass}>Senha Atual</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Nova Senha</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={inputClass}
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label className={labelClass}>Confirmar Nova Senha</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={passwordLoading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 font-bold text-white shadow-lg shadow-violet-500/25 transition-all hover:bg-violet-500 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 md:w-fit md:px-8"
              >
                <Save size={18} />
                {passwordLoading ? 'Alterando...' : 'Atualizar Senha'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
