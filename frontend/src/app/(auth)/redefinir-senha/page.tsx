'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/types';
import { useToast } from '@/components/ui/Toast';
import { Eye, EyeOff, KeyRound } from 'lucide-react';

const inputClass =
  'h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 pr-11 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/15 dark:bg-zinc-900/40 dark:text-zinc-100';

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const { toast } = useToast();

  const token = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get('token') ?? null,
    () => null,
  );
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError('Link inválido. Solicite uma nova redefinição.');
      return;
    }
    if (newPassword.length < 6) {
      setError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const api = createApiClient({ baseUrl: getDefaultApiBaseUrl() });
      await api.post(endpoints.auth.resetPassword, { token, newPassword });
      toast({
        type: 'success',
        title: 'Senha redefinida',
        description: 'Faça login com sua nova senha.',
      });
      router.replace('/login');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível redefinir a senha.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Token ainda carregando do query string
  const noToken =
    token === null &&
    typeof window !== 'undefined' &&
    !new URLSearchParams(window.location.search).get('token');

  if (noToken) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
          Link inválido
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          O link de redefinição é inválido ou está incompleto. Solicite um novo.
        </p>
        <a
          href="/esqueci-senha"
          className="text-sm font-semibold text-violet-600 hover:underline dark:text-violet-400"
        >
          Solicitar novo link
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 text-violet-600 dark:text-violet-400">
        <KeyRound size={26} />
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
          Nova senha
        </h1>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Crie uma nova senha para sua conta. Use pelo menos 6 caracteres.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Nova senha
          </label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              tabIndex={-1}
              aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Confirmar nova senha
          </label>
          <input
            type={showPass ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
            autoComplete="new-password"
          />
        </div>

        {error && <span className="text-xs text-red-500">{error}</span>}

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-violet-600 font-bold text-white shadow-lg shadow-violet-500/25 transition-all hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? 'Salvando...' : 'Redefinir senha'}
        </button>
      </form>

      <a
        href="/login"
        className="text-sm font-semibold text-violet-600 hover:underline dark:text-violet-400"
      >
        ← Voltar para o login
      </a>
    </div>
  );
}
