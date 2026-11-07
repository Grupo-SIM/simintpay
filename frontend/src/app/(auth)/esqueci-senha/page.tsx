'use client';

import { useState } from 'react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/types';
import { MailCheck } from 'lucide-react';

const inputClass =
  'h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError('Informe seu e-mail.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const api = createApiClient({ baseUrl: getDefaultApiBaseUrl() });
      await api.post(endpoints.auth.forgotPassword, { email: email.trim() });
      setSent(true);
    } catch (err) {
      // Mesmo em erro mostramos sucesso genérico (não vaza existência do e-mail),
      // exceto se for problema de rede claramente.
      if (err instanceof ApiError && err.status >= 500) {
        setError(
          'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
        );
      } else {
        setSent(true);
      }
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 text-violet-600 dark:text-violet-400">
          <MailCheck size={28} />
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
            Verifique seu e-mail
          </h1>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Se o e-mail informado estiver cadastrado, enviamos um link para você
          redefinir sua senha. O link expira em 1 hora. Confira também a caixa
          de spam.
        </p>
        <a
          href="/login"
          className="text-sm font-semibold text-violet-600 hover:underline dark:text-violet-400"
        >
          ← Voltar para o login
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
          Recuperar senha
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Informe o e-mail cadastrado na sua conta e enviaremos um link para
          criar uma nova senha.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            E-mail
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@empresa.com"
            className={inputClass}
            autoComplete="email"
          />
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-violet-600 font-bold text-white shadow-lg shadow-violet-500/25 transition-all hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? 'Enviando...' : 'Enviar link de redefinição'}
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
