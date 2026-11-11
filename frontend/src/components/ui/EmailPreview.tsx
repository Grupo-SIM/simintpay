'use client';

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface EmailPreviewProps {
  /** Corpo digitado pelo vendedor (estado emailBody). */
  body: string;
  /** Título do link/plano — entra no assunto "Acesso liberado: ...". */
  title?: string;
  /** Se preenchido, mostra o botão "Acessar conteúdo". */
  redirectUrl?: string | null;
  /** Nome de exemplo do comprador (no envio real vem o nome verdadeiro). */
  customerName?: string;
  /** Nomes dos arquivos anexados, listados no e-mail como "Arquivos em anexo". */
  attachmentNames?: string[];
}

type Rendered = { subject: string; html: string };

/**
 * Renderiza o e-mail com o MESMO template que o backend usa no envio
 * (backend/src/infrastructure/email/access-email-template.ts); só a logo
 * muda de `cid:` para data URL. Carregado sob demanda: a logo é um base64 grande.
 */
async function renderEmail({
  body,
  title,
  redirectUrl,
  customerName,
  attachmentNames,
}: Required<Pick<EmailPreviewProps, 'customerName'>> &
  EmailPreviewProps): Promise<Rendered> {
  const [template, logo] = await Promise.all([
    import('@backend-email/access-email-template'),
    import('@backend-email/simintpay-email-logo.asset'),
  ]);
  return template.renderAccessEmail({
    customerName,
    title: title?.trim() || 'seu produto',
    body: body.trim() ? body : template.DEFAULT_ACCESS_EMAIL_BODY,
    redirectUrl: redirectUrl?.trim() || null,
    attachmentNames,
    logoSrc: `data:image/png;base64,${logo.SIMINTPAY_EMAIL_LOGO_BASE64}`,
  });
}

function EmailPreviewModal({
  onClose,
  ...props
}: Required<Pick<EmailPreviewProps, 'customerName'>> &
  EmailPreviewProps & { onClose: () => void }) {
  const [rendered, setRendered] = useState<Rendered | null>(null);

  useEffect(() => {
    let active = true;
    void renderEmail(props).then((result) => {
      if (active) setRendered(result);
    });
    return () => {
      active = false;
    };
  }, [props.body, props.title, props.redirectUrl, props.customerName]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      open
      onClose={onClose}
      title="Pré-visualização do e-mail"
      maxWidth="max-w-3xl"
    >
      {rendered ? (
        <>
          <p className="mb-3 wrap-break-word text-sm text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
              Assunto:
            </span>{' '}
            {rendered.subject}
          </p>
          <iframe
            title="Pré-visualização do e-mail de entrega"
            sandbox=""
            srcDoc={`<!doctype html><base target="_blank"><body style="margin:0;padding:16px;background:#fff">${rendered.html}</body>`}
            className="h-[60vh] w-full rounded-2xl border border-zinc-200 bg-white dark:border-white/10"
          />
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
            Exemplo — no envio real, o nome do comprador substitui &quot;
            {props.customerName}&quot;.
          </p>
        </>
      ) : (
        <p className="text-sm text-zinc-500">Carregando…</p>
      )}
    </Modal>
  );
}

/** Botão que abre a pré-visualização fiel do e-mail de entrega num modal. */
export function EmailPreview({
  customerName = 'Cliente',
  ...props
}: EmailPreviewProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Eye aria-hidden className="h-4 w-4" />
        Pré-visualizar e-mail
      </Button>
      {open && (
        <EmailPreviewModal
          {...props}
          customerName={customerName}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
