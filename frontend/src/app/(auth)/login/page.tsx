'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';

import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/types';
import { useToast } from '@/components/ui/Toast';
import { prepareSalePushAccountChange } from '@/lib/sale-push';
import { clearUserCache } from '@/hooks/use-current-user';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const next = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get('next') ?? '/painel',
    () => '/painel',
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );

  async function doLogin() {
    const api = createApiClient({ baseUrl: getDefaultApiBaseUrl() });
    const { data } = await api.post<{
      data: { accessToken: string; expiresIn?: number };
    }>(endpoints.auth.login, { email, password });
    // Remove the previous account's device before replacing its authentication.
    await prepareSalePushAccountChange();
    clearUserCache();
    queryClient.clear();
    localStorage.setItem('access_token', data.accessToken);
    const maxAge = Math.max(60, Number(data.expiresIn ?? 86400)); // 1 dia se a API não enviar expiresIn
    document.cookie = `access_token=${data.accessToken}; path=/; max-age=${maxAge}; samesite=lax`;
    router.replace(next);
  }

  return (
    <>
      {/* heading */}
      <div className="lp-header">
        <h1 className="lp-title">Entrar na conta</h1>
      </div>

      {/* form */}
      <form
        className="lp-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const nextErrors: typeof errors = {};
          if (!email.trim()) nextErrors.email = 'Informe seu e-mail';
          if (!password.trim()) nextErrors.password = 'Informe sua senha';
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length) return;

          setLoading(true);
          try {
            await doLogin();
          } catch (err) {
            const e = err as unknown;
            if (e instanceof ApiError) {
              toast({
                type: 'error',
                title: 'Não foi possível entrar',
                description: e.message,
              });
              return;
            }
            toast({
              type: 'error',
              title: 'Erro inesperado',
              description: 'Tente novamente em instantes.',
            });
          } finally {
            setLoading(false);
          }
        }}
      >
        {/* email */}
        <div className="lp-field-group">
          <label className="lp-label">E-mail</label>
          <input
            id="login-email"
            type="email"
            className={`lp-input${errors.email ? ' lp-input-error' : ''}`}
            placeholder="email@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          {errors.email && <span className="lp-error-msg">{errors.email}</span>}
        </div>

        {/* password */}
        <div className="lp-field-group">
          <label className="lp-label">Senha</label>
          <div className="lp-pass-wrap">
            <input
              id="login-password"
              type={showPass ? 'text' : 'password'}
              className={`lp-input lp-input-pass${errors.password ? ' lp-input-error' : ''}`}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="lp-eye-btn"
              onClick={() => setShowPass((v) => !v)}
              tabIndex={-1}
              aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && (
            <span className="lp-error-msg">{errors.password}</span>
          )}
        </div>

        {/* forgot password */}
        <div className="lp-forgot-row">
          <a href="/esqueci-senha" className="lp-link lp-forgot">
            Esqueceu a senha?
          </a>
        </div>

        {/* submit */}
        <button
          id="login-submit"
          type="submit"
          disabled={loading}
          className="lp-submit-btn"
        >
          {loading ? <span className="lp-spinner" /> : 'Entrar'}
        </button>
      </form>

      <p className="lp-register-row">
        Ainda não tem uma conta?{' '}
        <a href="/cadastro" className="lp-link lp-register-link">
          Cadastre-se aqui
        </a>
      </p>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

        /* ─── HEADER ─── */
        .lp-header {
          margin-bottom: 36px;
        }

        .lp-title {
          font-family: 'Inter', sans-serif;
          font-size: 32px;
          font-weight: 800;
          color: var(--lp-title);
          margin: 0 0 10px 0;
          letter-spacing: -0.5px;
          line-height: 1.15;
        }

        .lp-subtitle {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: var(--lp-subtitle);
          margin: 0;
        }

        .lp-link {
          color: var(--lp-link);
          text-decoration: none;
          font-weight: 500;
          transition: color 0.2s;
        }

        .lp-link:hover {
          color: var(--lp-link-hover);
        }

        /* ─── FORM ─── */
        .lp-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .lp-field-group {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .lp-label {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--lp-label);
          letter-spacing: 0.2px;
        }

        .lp-input {
          font-family: 'Inter', sans-serif;
          width: 100%;
          padding: 13px 16px;
          border-radius: 10px;
          border: 1.5px solid var(--lp-input-border);
          background: var(--lp-input-bg);
          color: var(--lp-input-fg);
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
        }

        .lp-input::placeholder {
          color: var(--lp-input-placeholder);
        }

        .lp-input:focus {
          border-color: var(--lp-input-focus-border);
          background: var(--lp-input-focus-bg);
          box-shadow: 0 0 0 3px var(--lp-input-focus-ring);
        }

        .lp-input-error {
          border-color: rgba(248, 113, 113, 0.6) !important;
        }

        .lp-input-pass {
          padding-right: 44px;
        }

        .lp-pass-wrap {
          position: relative;
        }

        .lp-eye-btn {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: var(--lp-eye);
          padding: 0;
          display: flex;
          align-items: center;
          transition: color 0.2s;
        }

        .lp-eye-btn:hover {
          color: var(--lp-eye-hover);
        }

        .lp-error-msg {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: #f87171;
          margin-top: 2px;
        }

        /* ─── FORGOT ─── */
        .lp-forgot-row {
          display: flex;
          justify-content: flex-end;
          margin-top: -4px;
        }

        .lp-forgot {
          font-size: 13px;
          color: var(--lp-forgot);
        }

        .lp-forgot:hover {
          color: var(--lp-forgot-hover);
        }

        /* ─── SUBMIT BUTTON ─── */
        .lp-submit-btn {
          font-family: 'Inter', sans-serif;
          margin-top: 6px;
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.2px;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 4px 20px rgba(124, 58, 237, 0.40);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 50px;
        }

        .lp-submit-btn:hover:not(:disabled) {
          opacity: 0.92;
          transform: translateY(-1px);
          box-shadow: 0 6px 28px rgba(124, 58, 237, 0.55);
        }

        .lp-submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .lp-submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        /* ─── REGISTER LINK ─── */
        .lp-register-row {
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          color: var(--lp-subtitle);
          text-align: center;
          margin-top: 20px;
        }

        .lp-register-link {
          cursor: pointer;
          font-weight: 600;
        }

        /* ─── SPINNER ─── */
        .lp-spinner {
          width: 18px;
          height: 18px;
          border: 2.5px solid var(--lp-spinner-border);
          border-top-color: var(--lp-spinner-top);
          border-radius: 50%;
          animation: lp-spin 0.7s linear infinite;
        }

        @keyframes lp-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
