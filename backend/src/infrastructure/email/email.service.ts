import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /** Escapa HTML e renderiza texto simples como parágrafos, com URLs viram links clicáveis. */
  private renderPlainTextToHtml(text: string): string {
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

  /**
   * E-mail de acesso com corpo personalizado pelo vendedor (itens de ebook).
   * O texto é renderizado dentro do template padrão SIM INT PAY.
   */
  async sendEbookAccessEmail(input: {
    to: string;
    customerName: string;
    title: string;
    body: string;
    redirectUrl?: string | null;
    attachments?: { filename: string; content: Buffer }[];
  }): Promise<void> {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD
    ) {
      throw new Error(
        'SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)',
      );
    }

    const transport = this.createTransport();
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    const bodyHtml = this.renderPlainTextToHtml(input.body);

    const accessButton = input.redirectUrl
      ? `<div style="margin-top: 8px;">
           <a href="${input.redirectUrl}"
              style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                     padding: 12px 28px; border-radius: 8px; font-weight: bold;">
             Acessar conteúdo
           </a>
         </div>`
      : '';

    const attachments = input.attachments ?? [];
    const fileList =
      attachments.length > 0
        ? `<p style="font-size: 14px; margin: 16px 0 4px;">Arquivos em anexo:</p>
           <ul style="padding-left: 20px;">${attachments
             .map(
               (a) =>
                 `<li style="margin: 4px 0; color: #4c1d95;">${a.filename}</li>`,
             )
             .join('')}</ul>`
        : '';

    try {
      await transport.sendMail({
        from: `"SIM INT PAY" <${from}>`,
        to: input.to,
        subject: `Acesso liberado: ${input.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
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
              SIM INT PAY · JB Mídia
            </p>
          </div>
        `,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: 'application/pdf',
        })),
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de ebook personalizado para ${input.to}: ${String(err)}`,
      );
      throw err;
    }
  }

  private createTransport() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: process.env.SMTP_SECURE !== 'false',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  async sendSubscriptionAccess(input: {
    to: string;
    customerName: string;
    linkName: string;
    redirectUrl: string | null;
    orderId: string;
  }): Promise<void> {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD
    ) {
      throw new Error(
        'SMTP não configurado no api-machine (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)',
      );
    }

    const transport = this.createTransport();
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    const accessButton = input.redirectUrl
      ? `<a href="${input.redirectUrl}"
           style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                  padding: 12px 28px; border-radius: 8px; font-weight: bold; margin-top: 8px;">
           Acessar conteúdo
         </a>`
      : `<p style="color: #6b7280; font-size: 13px;">
           O link de acesso será disponibilizado em breve. Guarde seu ID de assinatura: <strong>${input.orderId}</strong>
         </p>`;

    try {
      await transport.sendMail({
        from: `"SIM INT PAY" <${from}>`,
        to: input.to,
        subject: `Acesso liberado: ${input.linkName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.customerName}</strong>!</p>
              <p>Sua assinatura <strong style="color: #6d28d9;">${input.linkName}</strong> foi confirmada com sucesso.</p>
              ${accessButton}
              <hr style="border: none; border-top: 1px solid #e5e3ff; margin: 24px 0;" />
              <p style="font-size: 12px; color: #9ca3af;">ID da assinatura: ${input.orderId}</p>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SIM INT PAY · JB Mídia
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de acesso de assinatura para ${input.to}: ${String(err)}`,
      );
      throw err;
    }
  }

  async sendWelcome(input: {
    to: string;
    name: string;
    tempPassword: string;
    loginUrl: string;
  }): Promise<void> {
    const transport = this.createTransport();

    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    try {
      await transport.sendMail({
        from: `"SIM INT PAY" <${from}>`,
        to: input.to,
        subject: 'Bem-vindo ao SIM INT PAY — sua conta foi criada',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.name}</strong>!</p>
              <p>Sua solicitação de cadastro foi <strong style="color: #6d28d9;">aprovada</strong>. Seu acesso ao SIM INT PAY está pronto.</p>

              <div style="background: #ffffff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280;">E-mail de acesso:</p>
                <p style="margin: 0 0 16px; font-weight: bold;">${input.to}</p>
                <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280;">Senha temporária:</p>
                <p style="margin: 0; font-family: monospace; font-size: 16px; font-weight: bold; letter-spacing: 2px; color: #6d28d9;">${input.tempPassword}</p>
              </div>

              <p style="color: #dc2626; font-size: 13px;">
                ⚠️ Por segurança, altere sua senha no primeiro acesso em <strong>Configurações → Perfil</strong>.
              </p>

              <a href="${input.loginUrl}"
                 style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                        padding: 12px 28px; border-radius: 8px; font-weight: bold; margin-top: 8px;">
                Acessar o SIM INT PAY
              </a>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SIM INT PAY · JB Mídia
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de boas-vindas para ${input.to}: ${String(err)}`,
      );
    }
  }

  async sendExpirationReminder(input: {
    to: string;
    customerName: string;
    vendedorName?: string;
    planName: string;
    expiresAt: Date;
    daysRemaining: number;
    renewUrl?: string;
  }): Promise<void> {
    const transport = this.createTransport();
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    const isExpired = input.daysRemaining <= 0;
    const subject = isExpired
      ? `Atenção: Seu plano ${input.planName} expirou`
      : `Lembrete: Seu plano ${input.planName} vence em ${input.daysRemaining} ${input.daysRemaining === 1 ? 'dia' : 'dias'}`;

    const dateStr = dayjs(input.expiresAt)
      .tz('America/Sao_Paulo')
      .format('DD/MM/YYYY [às] HH:mm');
    const vendedorInfo = input.vendedorName
      ? ` de <strong>${input.vendedorName}</strong>`
      : '';

    const message = isExpired
      ? `Seu acesso ao plano <strong>${input.planName}</strong>${vendedorInfo} expirou hoje (${dateStr}). Para continuar aproveitando os benefícios, realize a renovação.`
      : `O seu acesso ao plano <strong>${input.planName}</strong>${vendedorInfo} está chegando ao fim. Ele vencerá em <strong>${dateStr}</strong>.`;

    const renewButton = input.renewUrl
      ? `<div style="margin-top: 24px;">
           <a href="${input.renewUrl}"
              style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                     padding: 12px 28px; border-radius: 8px; font-weight: bold;">
             Renovar Plano
           </a>
         </div>`
      : '';

    try {
      await transport.sendMail({
        from: `"SIM INT PAY" <${from}>`,
        to: input.to,
        subject: subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.customerName}</strong>!</p>
              <p>${message}</p>
              ${renewButton}
              <hr style="border: none; border-top: 1px solid #e5e3ff; margin: 24px 0;" />
              <p style="font-size: 11px; color: #6b7280;">
                Se você já realizou a renovação, desconsidere este e-mail.
              </p>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SIM INT PAY · JB Mídia
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de lembrete de expiração para ${input.to}: ${String(err)}`,
      );
    }
  }

  /**
   * Lembrete de renovação de um contrato pago pelo comprador a cada ciclo.
   * Diferente dos demais, LANÇA em caso de falha: quem chama precisa saber que não foi entregue.
   */
  async sendRenewalReminder(input: {
    to: string;
    customerName: string;
    offerName: string;
    /** Valor do próximo ciclo, em reais. */
    amount: number;
    dueDate: Date;
    daysRemaining: number;
    renewUrl: string;
  }): Promise<void> {
    const esc = (s: string): string =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;
    const dateStr = dayjs(input.dueDate)
      .tz('America/Sao_Paulo')
      .format('DD/MM/YYYY');
    const amountStr = input.amount.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    const when =
      input.daysRemaining <= 0
        ? 'vence hoje'
        : input.daysRemaining === 1
          ? 'vence amanhã'
          : `vence em ${input.daysRemaining} dias`;
    const subject = `Renove ${input.offerName}: sua assinatura ${when}`;

    await this.createTransport().sendMail({
      from: `"SIM INT PAY" <${from}>`,
      to: input.to,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
          <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
          </div>
          <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
            <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${esc(input.customerName)}</strong>!</p>
            <p>Sua assinatura de <strong>${esc(input.offerName)}</strong> ${when}, em <strong>${dateStr}</strong>.
               Para continuar com o acesso, pague a renovação de <strong>${amountStr}</strong> até essa data.</p>
            <div style="margin-top: 24px;">
              <a href="${esc(input.renewUrl)}"
                 style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                        padding: 12px 28px; border-radius: 8px; font-weight: bold;">
                Renovar agora
              </a>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e3ff; margin: 24px 0;" />
            <p style="font-size: 11px; color: #6b7280;">
              Se você já realizou a renovação, desconsidere este e-mail.
            </p>
          </div>
          <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
            SIM INT PAY · JB Mídia
          </p>
        </div>
      `,
    });
  }

  /** Botão de redirecionamento pós-pagamento (aparece só quando há redirectUrl). */
  private redirectButtonHtml(redirectUrl?: string | null): string {
    if (!redirectUrl?.trim()) return '';
    return `
      <div style="margin: 24px 0 8px;">
        <a href="${redirectUrl}"
           style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                  padding: 12px 28px; border-radius: 8px; font-weight: bold;">
          Continuar
        </a>
      </div>`;
  }

  async sendPaymentLinkFiles(input: {
    to: string;
    customerName: string;
    linkTitle: string;
    attachments: { filename: string; content: Buffer }[];
    redirectUrl?: string | null;
  }): Promise<void> {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD
    ) {
      throw new Error(
        'SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)',
      );
    }

    const transport = this.createTransport();
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    const fileList = input.attachments
      .map(
        (a) => `<li style="margin: 4px 0; color: #4c1d95;">${a.filename}</li>`,
      )
      .join('');

    try {
      await transport.sendMail({
        from: `"SIM INT PAY" <${from}>`,
        to: input.to,
        subject: `Seus arquivos — ${input.linkTitle}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.customerName}</strong>!</p>
              <p>Seu pagamento de <strong style="color: #6d28d9;">${input.linkTitle}</strong> foi confirmado.</p>
              <p>Seguem em anexo os seus arquivos:</p>
              <ul style="padding-left: 20px;">${fileList}</ul>
              ${this.redirectButtonHtml(input.redirectUrl)}
              <hr style="border: none; border-top: 1px solid #e5e3ff; margin: 24px 0;" />
              <p style="font-size: 12px; color: #9ca3af;">Se você não realizou este pagamento, entre em contato conosco.</p>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SIM INT PAY · JB Mídia
            </p>
          </div>
        `,
        attachments: input.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: 'application/pdf',
        })),
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail com PDFs para ${input.to}: ${String(err)}`,
      );
      throw err;
    }
  }

  /** E-mail de redefinição de senha com link contendo o token de reset. */
  async sendPasswordReset(input: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<void> {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD
    ) {
      throw new Error(
        'SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)',
      );
    }
    const transport = this.createTransport();
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    try {
      await transport.sendMail({
        from: `"SIM INT PAY" <${from}>`,
        to: input.to,
        subject: 'Redefinição de senha — SIM INT PAY',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.name}</strong>!</p>
              <p>Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha:</p>
              <div style="margin: 24px 0;">
                <a href="${input.resetUrl}"
                   style="display: inline-block; background: #6d28d9; color: #fff; text-decoration: none;
                          padding: 12px 28px; border-radius: 8px; font-weight: bold;">
                  Redefinir minha senha
                </a>
              </div>
              <p style="font-size: 13px; color: #6b7280;">Este link expira em 1 hora. Se você não solicitou a redefinição, ignore este e-mail — sua senha continua a mesma.</p>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SIM INT PAY · JB Mídia
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de redefinição para ${input.to}: ${String(err)}`,
      );
      throw err;
    }
  }

  /** E-mail simples de pagamento confirmado com botão de redirecionamento. */
  async sendPaymentLinkConfirmation(input: {
    to: string;
    customerName: string;
    linkTitle: string;
    redirectUrl: string;
  }): Promise<void> {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD
    ) {
      throw new Error(
        'SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)',
      );
    }
    const transport = this.createTransport();
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    try {
      await transport.sendMail({
        from: `"SIM INT PAY" <${from}>`,
        to: input.to,
        subject: `Pagamento confirmado — ${input.linkTitle}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SIM INT PAY</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.customerName}</strong>!</p>
              <p>Seu pagamento de <strong style="color: #6d28d9;">${input.linkTitle}</strong> foi confirmado. Clique no botão abaixo para continuar:</p>
              ${this.redirectButtonHtml(input.redirectUrl)}
              <hr style="border: none; border-top: 1px solid #e5e3ff; margin: 24px 0;" />
              <p style="font-size: 12px; color: #9ca3af;">Se você não realizou este pagamento, entre em contato conosco.</p>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SIM INT PAY · JB Mídia
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de confirmação para ${input.to}: ${String(err)}`,
      );
      throw err;
    }
  }
}
