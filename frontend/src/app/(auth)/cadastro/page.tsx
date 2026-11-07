'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Dropdown } from '@/components/ui/Dropdown';

import { useToast } from '@/components/ui/Toast';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/types';

type Step = 1 | 2 | 'success';

type LeadForm = {
  name: string;
  phone: string;
  email: string;
  cpf: string;
  razaoSocial: string;
  cnpj: string;
  faturamento: string;
  tempoOperacao: string;
  modeloOperacao: string;
  cargo: string;
  comoConheceu: string;
};

function onlyDigits(s: string) {
  return s.replace(/\D+/g, '');
}

function isValidEmail(s: string) {
  return /^\S+@\S+\.\S+$/.test(s);
}

function maskPhone(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskDocument(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  const base = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}`;
  if (d.length <= 12) return base;
  return `${base}-${d.slice(12)}`;
}

function maskCnpj(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export default function CadastroPage() {
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();

  const searchParams = useSearchParams();
  const referredByCode = searchParams.get('ref')?.trim() || undefined;

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<LeadForm>({
    name: '',
    phone: '',
    email: '',
    cpf: '',
    razaoSocial: '',
    cnpj: '',
    faturamento: '',
    tempoOperacao: '',
    modeloOperacao: '',
    cargo: '',
    comoConheceu: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof LeadForm, string>>>(
    {},
  );

  const faturamentoOptions = useMemo(
    () => [
      { value: 'ATE_10K', label: 'Até R$ 10.000' },
      { value: 'DE_10K_A_50K', label: 'De R$ 10.000 a R$ 50.000' },
      { value: 'DE_50K_A_100K', label: 'De R$ 50.000 a R$ 100.000' },
      { value: 'DE_100K_A_500K', label: 'De R$ 100.000 a R$ 500.000' },
      { value: 'ACIMA_500K', label: 'Acima de R$ 500.000' },
    ],
    [],
  );

  const tempoOptions = useMemo(
    () => [
      { value: 'MENOS_1_ANO', label: 'Menos de 1 ano' },
      { value: 'DE_1_A_3_ANOS', label: 'De 1 a 3 anos' },
      { value: 'DE_3_A_5_ANOS', label: 'De 3 a 5 anos' },
      { value: 'MAIS_5_ANOS', label: 'Mais de 5 anos' },
    ],
    [],
  );

  const modeloOptions = useMemo(
    () => [
      { value: '', label: 'Não informado' },
      { value: 'ECOMMERCE', label: 'E-commerce' },
      { value: 'PRESENCIAL', label: 'Presencial' },
      { value: 'AMBOS', label: 'Ambos' },
      { value: 'SERVICOS', label: 'Serviços' },
      { value: 'ASSINATURAS', label: 'Assinaturas' },
    ],
    [],
  );

  const cargoOptions = useMemo(
    () => [
      { value: 'SOCIO', label: 'Sócio/Proprietário' },
      { value: 'DIRETOR', label: 'Diretor' },
      { value: 'GERENTE', label: 'Gerente' },
      { value: 'FINANCEIRO', label: 'Financeiro' },
      { value: 'TI', label: 'TI' },
      { value: 'OUTRO', label: 'Outro' },
    ],
    [],
  );

  const comoConheceuOptions = useMemo(
    () => [
      { value: '', label: 'Não informado' },
      { value: 'Google', label: 'Google' },
      { value: 'Redes Sociais', label: 'Redes Sociais' },
      { value: 'Indicação', label: 'Indicação' },
      { value: 'Outro', label: 'Outro' },
    ],
    [],
  );

  if (step === 'success') {
    return (
      <>
        <div className="lp-header">
          <h1 className="lp-title">Solicitação enviada!</h1>
          <p className="lp-subtitle">
            Analisaremos seus dados e entraremos em contato pelo e-mail
            informado com suas credenciais de acesso.
          </p>
        </div>
        <Link
          href="/"
          className="lp-submit-btn"
          style={{
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          Voltar para o início
        </Link>
        <Style />
      </>
    );
  }

  return (
    <>
      <div className="lp-header">
        <h1 className="lp-title">
          {step === 1 ? 'Solicitar acesso' : 'Dados da empresa'}
        </h1>
        <p className="lp-subtitle">
          {step === 1
            ? 'Preencha seus dados para enviar uma solicitação de cadastro.'
            : 'Complete as informações da empresa para finalizarmos a solicitação.'}
        </p>
      </div>

      <form
        className="lp-form"
        onSubmit={async (e) => {
          e.preventDefault();

          if (step === 1) {
            const nextErrors: typeof errors = {};
            if (!form.name.trim())
              nextErrors.name = 'Informe seu nome completo';
            if (!form.phone.trim())
              nextErrors.phone = 'Informe um número de contato';
            else if (onlyDigits(form.phone).length < 10)
              nextErrors.phone = 'Telefone inválido';
            if (!form.email.trim())
              nextErrors.email = 'Informe seu e-mail corporativo';
            else if (!isValidEmail(form.email))
              nextErrors.email = 'E-mail inválido';
            if (!form.cpf.trim()) nextErrors.cpf = 'Informe o CPF ou CNPJ';
            else {
              const len = onlyDigits(form.cpf).length;
              if (len !== 11 && len !== 14)
                nextErrors.cpf = 'CPF ou CNPJ inválido';
            }
            setErrors(nextErrors);
            if (Object.keys(nextErrors).length) return;
            setStep(2);
            return;
          }

          const nextErrors: typeof errors = {};
          if (!form.razaoSocial.trim())
            nextErrors.razaoSocial = 'Informe a razão social';
          if (!form.cnpj.trim()) nextErrors.cnpj = 'Informe o CNPJ';
          else if (onlyDigits(form.cnpj).length !== 14)
            nextErrors.cnpj = 'CNPJ inválido';
          if (!form.faturamento)
            nextErrors.faturamento = 'Selecione o faturamento';
          if (!form.tempoOperacao)
            nextErrors.tempoOperacao = 'Selecione o tempo de operação';
          if (!form.cargo) nextErrors.cargo = 'Selecione o cargo';
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length) return;

          const api = createApiClient({ baseUrl: getDefaultApiBaseUrl() });
          setLoading(true);
          try {
            const payload = {
              name: form.name.trim(),
              phone: form.phone.trim(),
              email: form.email.trim().toLowerCase(),
              cpf: form.cpf.trim(),
              razaoSocial: form.razaoSocial.trim(),
              cnpj: form.cnpj.trim(),
              faturamento: form.faturamento,
              tempoOperacao: form.tempoOperacao,
              ...(form.modeloOperacao
                ? { modeloOperacao: form.modeloOperacao }
                : {}),
              cargo: form.cargo,
              ...(form.comoConheceu ? { comoConheceu: form.comoConheceu } : {}),
              ...(referredByCode ? { referredByCode } : {}),
            };

            await api.post<{ data: { id: string }; message: string }>(
              endpoints.leads.create,
              payload,
            );

            fetch('/api/send-lead-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }).catch(() => null);

            setStep('success');
          } catch (err) {
            const e = err as unknown;
            if (e instanceof ApiError) {
              if (e.status === 409) {
                const msg = e.message.toLowerCase();
                setErrors((prev) => ({ ...prev, email: e.message }));
                if (msg.includes('cnpj'))
                  setErrors((prev) => ({ ...prev, cnpj: e.message }));
                return;
              }
              toast({
                type: 'error',
                title: 'Não foi possível enviar',
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
        {step === 1 ? (
          <>
            <Field label="Nome completo *" error={errors.name}>
              <input
                className={`lp-input${errors.name ? ' lp-input-error' : ''}`}
                placeholder="João Silva"
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
                autoComplete="name"
              />
            </Field>

            <Field label="Número de contato *" error={errors.phone}>
              <input
                className={`lp-input${errors.phone ? ' lp-input-error' : ''}`}
                placeholder="(11) 99999-9999"
                value={form.phone}
                onChange={(e) =>
                  setForm((p) => ({ ...p, phone: maskPhone(e.target.value) }))
                }
                inputMode="tel"
                autoComplete="tel"
              />
            </Field>

            <Field label="E-mail corporativo *" error={errors.email}>
              <input
                className={`lp-input${errors.email ? ' lp-input-error' : ''}`}
                placeholder="email@empresa.com"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((p) => ({ ...p, email: e.target.value }))
                }
                autoComplete="email"
              />
            </Field>

            <Field label="CPF ou CNPJ *" error={errors.cpf}>
              <input
                className={`lp-input${errors.cpf ? ' lp-input-error' : ''}`}
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                value={form.cpf}
                onChange={(e) =>
                  setForm((p) => ({ ...p, cpf: maskDocument(e.target.value) }))
                }
                inputMode="numeric"
              />
            </Field>

            <button
              type="submit"
              className="lp-submit-btn"
              style={{ marginTop: 6 }}
            >
              Próximo
            </button>
          </>
        ) : (
          <>
            <Field label="Razão social *" error={errors.razaoSocial}>
              <input
                className={`lp-input${errors.razaoSocial ? ' lp-input-error' : ''}`}
                placeholder="Empresa LTDA"
                value={form.razaoSocial}
                onChange={(e) =>
                  setForm((p) => ({ ...p, razaoSocial: e.target.value }))
                }
              />
            </Field>

            <Field label="CNPJ *" error={errors.cnpj}>
              <input
                className={`lp-input${errors.cnpj ? ' lp-input-error' : ''}`}
                placeholder="12.345.678/0001-90"
                value={form.cnpj}
                onChange={(e) =>
                  setForm((p) => ({ ...p, cnpj: maskCnpj(e.target.value) }))
                }
                inputMode="numeric"
              />
            </Field>

            <Field label="Faturamento *" error={errors.faturamento}>
              <Dropdown
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                value={form.faturamento}
                onChange={(value) =>
                  setForm((p) => ({ ...p, faturamento: value }))
                }
                options={faturamentoOptions}
                placeholder="Selecione"
                required
                className={errors.faturamento ? 'border-red-500' : undefined}
              />
            </Field>

            <Field label="Tempo de Operação *" error={errors.tempoOperacao}>
              <Dropdown
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                value={form.tempoOperacao}
                onChange={(value) =>
                  setForm((p) => ({ ...p, tempoOperacao: value }))
                }
                options={tempoOptions}
                placeholder="Selecione"
                required
                className={errors.tempoOperacao ? 'border-red-500' : undefined}
              />
            </Field>

            <Field label="Modelo de Operação">
              <Dropdown
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                value={form.modeloOperacao}
                onChange={(value) =>
                  setForm((p) => ({ ...p, modeloOperacao: value }))
                }
                options={modeloOptions}
                placeholder="Selecione"
              />
            </Field>

            <Field label="Cargo na empresa *" error={errors.cargo}>
              <Dropdown
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                value={form.cargo}
                onChange={(value) => setForm((p) => ({ ...p, cargo: value }))}
                options={cargoOptions}
                placeholder="Selecione"
                required
                className={errors.cargo ? 'border-red-500' : undefined}
              />
            </Field>

            <Field label="Como conheceu a Simintpay?">
              <Dropdown
                theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                value={form.comoConheceu}
                onChange={(value) =>
                  setForm((p) => ({ ...p, comoConheceu: value }))
                }
                options={comoConheceuOptions}
                placeholder="Selecione"
              />
            </Field>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginTop: 6,
              }}
            >
              <button
                type="button"
                onClick={() => setStep(1)}
                className="lp-outline-btn"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="lp-submit-btn"
              >
                {loading ? (
                  <span className="lp-spinner" />
                ) : (
                  'Enviar solicitação'
                )}
              </button>
            </div>
          </>
        )}
      </form>

      <p className="lp-register-row" style={{ marginTop: 24 }}>
        Já tem uma conta?{' '}
        <a
          href="/login"
          className="lp-link"
          style={{ fontWeight: 600, cursor: 'pointer' }}
        >
          Entrar aqui
        </a>
      </p>

      <Style />
    </>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="lp-field-group">
      <label className="lp-label">{label}</label>
      {children}
      {error && <span className="lp-error-msg">{error}</span>}
    </div>
  );
}

function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

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


      .lp-error-msg {
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        color: #f87171;
        margin-top: 2px;
      }

      .lp-submit-btn {
        font-family: 'Inter', sans-serif;
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

      .lp-outline-btn {
        font-family: 'Inter', sans-serif;
        width: 100%;
        padding: 14px;
        border-radius: 10px;
        border: 1.5px solid var(--lp-input-border);
        background: transparent;
        color: var(--lp-input-fg);
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.2px;
        transition: background 0.2s, border-color 0.2s;
        min-height: 50px;
      }

      .lp-outline-btn:hover {
        background: var(--lp-input-bg);
        border-color: var(--lp-input-focus-border);
      }

      .lp-register-row {
        font-family: 'Inter', sans-serif;
        font-size: 13.5px;
        color: var(--lp-subtitle);
        text-align: center;
      }

      .lp-spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: lp-spin 0.7s linear infinite;
      }

      @keyframes lp-spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  );
}
