// Template do e-mail de entrega/acesso. Sem dependências: o frontend importa este
// mesmo arquivo para a pré-visualização, então ela é idêntica ao e-mail enviado.

export const DEFAULT_ACCESS_EMAIL_BODY =
  'Seu pagamento foi aprovado. Seguem os arquivos da compra.';

/** Escapa HTML e renderiza texto simples como parágrafos, com URLs viram links clicáveis. */
export function renderPlainTextToHtml(text: string): string {
  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const linkify = (escaped: string): string =>
    escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      // Não inclui pontuação final comum na URL clicável
      const trailingMatch = url.match(/[).,;!?]+$/);
      const trailing = trailingMatch ? trailingMatch[0] : '';
      const clean = trailing ? url.slice(0, -trailing.length) : url;
      return `<a href="${clean}" style="color: #6d28d9; word-break: break-all;">${clean}</a>${trailing}`;
    });

  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => {
      const inner = block
        .split('\n')
        .map((line) => linkify(escapeHtml(line)))
        .join('<br />');
      return `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.55; overflow-wrap: break-word; word-break: break-word;">${inner}</p>`;
    })
    .join('');
}

export type AccessEmailInput = {
  customerName: string;
  title: string;
  body: string;
  redirectUrl?: string | null;
  attachmentNames?: string[];
  /** `cid:` no envio real; data URL na pré-visualização. */
  logoSrc: string;
};

export function renderAccessEmail(input: AccessEmailInput): {
  subject: string;
  html: string;
} {
  const bodyHtml = renderPlainTextToHtml(input.body);

  const accessButton = input.redirectUrl
    ? `<div style="margin-top: 8px;">
           <a href="${input.redirectUrl}"
              style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                     padding: 12px 28px; border-radius: 8px; font-weight: bold;">
             Acessar conteúdo
           </a>
         </div>`
    : '';

  const names = input.attachmentNames ?? [];
  const fileList =
    names.length > 0
      ? `<p style="font-size: 14px; margin: 16px 0 4px;">Arquivos em anexo:</p>
           <ul style="padding-left: 20px;">${names
             .map(
               (name) =>
                 `<li style="margin: 4px 0; color: #4c1d95;">${name}</li>`,
             )
             .join('')}</ul>`
      : '';

  return {
    subject: `Acesso liberado: ${input.title}`,
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <img src="${input.logoSrc}" height="40" alt="SimIntPay" style="display: block; height: 40px; width: auto;" />
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.customerName}</strong>!</p>
              ${bodyHtml}
              ${accessButton}
              ${fileList}
              <hr style="border: none; border-top: 1px solid #e5e3ff; margin: 24px 0;" />
              <p style="font-size: 12px; color: #9ca3af;">Se você não realizou este pagamento, entre em contato conosco.</p>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SIM INT PAY
            </p>
          </div>
        `,
  };
}
