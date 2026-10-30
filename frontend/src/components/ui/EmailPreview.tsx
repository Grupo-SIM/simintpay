'use client';

import { useState, type CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Réplica EXATA do renderizador do backend (EmailService.renderPlainTextToHtml):
 * escapa HTML, transforma blocos separados por linha em branco em <p>, quebras
 * simples em <br /> e URLs (http/https) em links clicáveis.
 * Mantenha em sincronia com api-machine/src/infrastructure/email/email.service.ts.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkify(escaped: string): string {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const trailingMatch = url.match(/[).,;!?]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const clean = trailing ? url.slice(0, -trailing.length) : url;
    return `<a href="${clean}" style="color: #6d28d9; word-break: break-all;">${clean}</a>${trailing}`;
  });
}

/** Estilo do parágrafo — inclui quebra de palavras longas para nunca vazar o card. */
const PARAGRAPH_STYLE =
  'margin: 0 0 14px; font-size: 15px; line-height: 1.55; overflow-wrap: break-word; word-break: break-word;';

function renderPlainTextToHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => {
      const inner = block
        .split('\n')
        .map((line) => linkify(escapeHtml(line)))
        .join('<br />');
      return `<p style="${PARAGRAPH_STYLE}">${inner}</p>`;
    })
    .join('');
}

const buttonStyle: CSSProperties = {
  display: 'inline-block',
  background: '#6d28d9',
  color: '#fff',
  textDecoration: 'none',
  padding: '12px 28px',
  borderRadius: 8,
  fontWeight: 'bold',
};

interface EmailPreviewProps {
  /** Corpo digitado pelo vendedor (estado emailBody). */
  body: string;
  /** Título do link/plano — entra no assunto "Acesso liberado: ...". */
  title?: string;
  /** Se preenchido, mostra o botão "Acessar conteúdo". */
  redirectUrl?: string | null;
  /** Nome de exemplo do comprador (no envio real vem o nome verdadeiro). */
  customerName?: string;
}

/**
 * Pré-visualização fiel de como o e-mail personalizado chega ao comprador,
 * espelhando o template sendEbookAccessEmail do backend.
 * Fica recolhida por padrão e abre/fecha pelo botão.
 */
export function EmailPreview({
  body,
  title,
  redirectUrl,
  customerName = 'Cliente',
}: EmailPreviewProps) {
  const [open, setOpen] = useState(false);

  const trimmed = body.trim();
  const bodyHtml = trimmed
    ? renderPlainTextToHtml(body)
    : `<p style="${PARAGRAPH_STYLE} color: #9ca3af;">Sua mensagem aparecerá aqui conforme você digita…</p>`;
  const hasRedirect = Boolean(redirectUrl && redirectUrl.trim());
  const subjectTitle = title?.trim() || 'seu produto';

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        {open
          ? 'Ocultar pré-visualização do e-mail'
          : 'Ver pré-visualização do e-mail'}
      </button>

      {open && (
        <div className="mt-3">
          <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-100 p-4 dark:border-white/10 dark:bg-black/20">
            {/* Assunto */}
            <div className="mb-3 wrap-break-word text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-semibold text-zinc-600 dark:text-zinc-300">
                Assunto:
              </span>{' '}
              Acesso liberado: {subjectTitle}
            </div>

            {/* Corpo do e-mail (cores fixas, como o comprador vê na caixa de entrada) */}
            <div
              style={{
                fontFamily: 'Arial, sans-serif',
                width: '100%',
                maxWidth: 600,
                margin: '0 auto',
                color: '#1e1b4b',
              }}
            >
              <div
                style={{
                  background: '#0f0c1e',
                  padding: '24px 32px',
                  borderRadius: '12px 12px 0 0',
                }}
              >
                <h1 style={{ color: '#a78bfa', margin: 0, fontSize: 22 }}>
                  SIM INT PAY
                </h1>
              </div>
              <div
                style={{
                  background: '#f8f7ff',
                  padding: 32,
                  borderRadius: '0 0 12px 12px',
                  border: '1px solid #e5e3ff',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                }}
              >
                <p style={{ fontSize: 16, marginTop: 0 }}>
                  Olá, <strong>{customerName}</strong>!
                </p>
                <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                {hasRedirect && (
                  <div style={{ marginTop: 8 }}>
                    <a
                      href={redirectUrl ?? '#'}
                      style={buttonStyle}
                      onClick={(e) => e.preventDefault()}
                    >
                      Acessar conteúdo
                    </a>
                  </div>
                )}
                <hr
                  style={{
                    border: 'none',
                    borderTop: '1px solid #e5e3ff',
                    margin: '24px 0',
                  }}
                />
                <p style={{ fontSize: 12, color: '#9ca3af' }}>
                  Se você não realizou este pagamento, entre em contato conosco.
                </p>
              </div>
              <p
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  color: '#9ca3af',
                  marginTop: 16,
                }}
              >
                SIM INT PAY · JB Mídia
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
            Exemplo — no envio real, o nome do comprador substitui &quot;
            {customerName}&quot;.
            {hasRedirect
              ? ''
              : ' Adicione uma URL de redirecionamento para incluir o botão de acesso.'}
          </p>
        </div>
      )}
    </div>
  );
}
