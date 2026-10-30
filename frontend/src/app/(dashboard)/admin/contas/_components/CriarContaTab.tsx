'use client';

import { useDebouncedInput } from '@/hooks/use-debounced-input';
import { useState, useCallback } from 'react';
import {
  Copy,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

function randomPassword(length = 16): string {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export default function CriarContaTab({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { user, loading: loadingUser } = useCurrentUser();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [docType, setDocType] = useState<'cpf' | 'cnpj'>('cpf');
  const [document, setDocument] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [localPassword, updatePassword, flushPassword] = useDebouncedInput(
    password,
    setPassword,
  );
  const [localDocument, updateDocument, flushDocument] = useDebouncedInput(
    document,
    setDocument,
  );

  const handleDocTypeChange = useCallback((type: 'cpf' | 'cnpj') => {
    setDocType(type);
    setDocument('');
    setError(null);
  }, []);

  const handleDocumentChange = useCallback(
    (value: string) => {
      updateDocument(docType === 'cpf' ? formatCpf(value) : formatCnpj(value));
    },
    [docType, updateDocument],
  );

  const handleGeneratePassword = useCallback(() => {
    setPassword(randomPassword());
    setShowPassword(true);
    toast({ type: 'info', title: 'Senha gerada' });
  }, [toast]);

  const handleCopyPassword = useCallback(async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast({ type: 'info', title: 'Senha copiada' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        type: 'error',
        title: 'Erro ao copiar',
        description: 'Não foi possível copiar a senha.',
      });
    }
  }, [password, toast]);

  const handleSubmit = async (form: HTMLFormElement) => {
    const values = new FormData(form);
    const email = String(values.get('email') ?? '');
    const password = String(values.get('password') ?? '');
    const document = String(values.get('document') ?? '');
    setError(null);

    if (!email.trim()) {
      setError('Informe o e-mail.');
      return;
    }
    if (!password.trim()) {
      setError('Gere ou informe uma senha.');
      return;
    }

    const digits = document.replace(/\D/g, '');
    if (docType === 'cpf' && digits.length !== 11) {
      setError('CPF inválido. Informe os 11 dígitos.');
      return;
    }
    if (docType === 'cnpj' && digits.length !== 14) {
      setError('CNPJ inválido. Informe os 14 dígitos.');
      return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => token ?? undefined,
      });
      const body =
        docType === 'cpf'
          ? { email: email.trim(), password, cpf: digits }
          : { email: email.trim(), password, cnpj: digits };
      const res = await api.post<{
        data: {
          userId: string;
          email: string;
          cpf: string | null;
          cnpj: string | null;
        };
        message: string;
      }>(endpoints.admin.criarConta, body);
      onCreated();
      toast({
        type: 'success',
        title: 'Conta criada!',
        description: `Conta criada para ${res.data.email}.`,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erro ao criar conta. Tente novamente.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  if (loadingUser || !user?.isAdmin) return null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit(event.currentTarget);
      }}
      className="flex flex-col gap-6"
    >
      {/* E-mail */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new-account-email"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          E-mail <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          id="new-account-email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="usuario@email.com"
          disabled={isLoading}
          className="h-11 rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-400"
        />
      </div>

      {/* Senha */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new-account-password"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Senha <span className="text-red-500">*</span>
        </label>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              id="new-account-password"
              name="password"
              autoComplete="new-password"
              required
              value={localPassword}
              onBlur={flushPassword}
              onChange={(e) => updatePassword(e.target.value)}
              placeholder="Digite ou gere uma senha"
              disabled={isLoading}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 pr-12 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-400"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              className="cursor-pointer rounded border border-zinc-200 p-1 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleGeneratePassword}
              disabled={isLoading}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 hover:border-violet-200 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
            >
              <RefreshCw
                size={14}
                className={isLoading ? 'animate-spin' : ''}
              />
              Gerar senha
            </button>
            <button
              type="button"
              onClick={handleCopyPassword}
              disabled={isLoading || !password}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 hover:border-violet-200 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
            >
              {copied ? (
                <CheckCircle size={14} className="text-emerald-500" />
              ) : (
                <Copy size={14} />
              )}
              {copied ? 'Copiada!' : 'Copiar'}
            </button>
          </div>
        </div>
      </div>

      {/* CPF / CNPJ */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-account-document" className="text-sm font-medium">
          CPF/CNPJ <span className="text-red-500">*</span>
        </label>
        {/* Toggle */}
        <div className="flex items-center gap-1 self-start rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-white/10 dark:bg-white/5">
          <button
            type="button"
            onClick={() => handleDocTypeChange('cpf')}
            disabled={isLoading}
            className={[
              'cursor-pointer rounded-md border px-4 py-1.5 text-xs font-semibold transition-all',
              docType === 'cpf'
                ? 'bg-white text-violet-600 shadow-sm dark:bg-white/10 dark:text-violet-400'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
            ].join(' ')}
          >
            CPF
          </button>
          <button
            type="button"
            onClick={() => handleDocTypeChange('cnpj')}
            disabled={isLoading}
            className={[
              'cursor-pointer rounded-md border px-4 py-1.5 text-xs font-semibold transition-all',
              docType === 'cnpj'
                ? 'bg-white text-violet-600 shadow-sm dark:bg-white/10 dark:text-violet-400'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
            ].join(' ')}
          >
            CNPJ
          </button>
        </div>

        <input
          type="text"
          inputMode="numeric"
          id="new-account-document"
          name="document"
          aria-label={docType === 'cpf' ? 'CPF' : 'CNPJ'}
          required
          value={localDocument}
          onBlur={flushDocument}
          onChange={(e) => handleDocumentChange(e.target.value)}
          placeholder={
            docType === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'
          }
          disabled={isLoading}
          className="h-11 rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-400"
        />
        <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500 text-center">
          {docType === 'cpf'
            ? 'O CPF será utilizado para identificação e perfil da conta.'
            : 'O CNPJ será utilizado para identificação e perfil da conta.'}
        </p>
      </div>

      {/* Mensagem de Feedback */}
      <div className="min-h-[40px]">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-200">
            <AlertCircle
              size={16}
              className="mt-0.5 shrink-0 text-red-500 dark:text-red-400"
            />
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="h-12 w-full cursor-pointer rounded-xl border border-violet-500 bg-violet-600 text-sm font-bold text-white shadow-lg shadow-violet-500/25 transition-all hover:bg-violet-500 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <RefreshCw size={16} className="animate-spin" />
            Criando conta...
          </span>
        ) : (
          'Criar conta agora'
        )}
      </button>
    </form>
  );
}
