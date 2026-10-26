import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  wrapAtlasEmail,
  ATLAS_EMAIL_LOGO_CID,
} from '../common/atlas-email-template.helper';
import { ATLAS_EMAIL_LOGO_BASE64 } from '../common/atlas-email-logo.asset';

interface AtlasEmailOptions {
  to: string;
  subject: string;
  html: string;
  previewText?: string;
}

@Injectable()
export class AtlasMailService {
  private readonly logger = new Logger(AtlasMailService.name);

  private createTransport(): nodemailer.Transporter {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      throw new Error('SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)');
    }
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

  /** Envia e-mail Atlas envolvendo o conteúdo no template central (logo via CID). */
  async sendMail(options: AtlasEmailOptions): Promise<void> {
    const { to, subject, html, previewText } = options;
    const transport = this.createTransport();
    const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;

    // Envolve no template central (a menos que o conteúdo já esteja envolvido)
    const finalHtml = html.includes('ae-content')
      ? html
      : wrapAtlasEmail(html, previewText ?? subject);

    const mailOptions: nodemailer.SendMailOptions = {
      from: `"Atlashost" <${from}>`,
      to,
      subject,
      html: finalHtml,
      // Logo embutida inline (CID) — renderiza no Gmail sem depender de hosting externo
      attachments: finalHtml.includes('cid:atlaslogo')
        ? [
            {
              filename: 'atlaslogo.png',
              content: ATLAS_EMAIL_LOGO_BASE64,
              encoding: 'base64',
              cid: ATLAS_EMAIL_LOGO_CID,
              contentType: 'image/png',
              contentDisposition: 'inline',
            },
          ]
        : [],
    };

    try {
      await transport.sendMail(mailOptions);
    } catch (error) {
      this.logger.error(`Falha ao enviar e-mail Atlas para ${to}: ${String(error)}`);
      throw new Error(`Falha ao enviar email: ${error.message}`);
    }
  }

  /** E-mail com os dados de acesso da VM (IP e senha) do cliente. */
  async sendVmAccess(input: {
    to: string;
    vmIp: string;
    vmPassword: string;
  }): Promise<void> {
    const { to, vmIp, vmPassword } = input;
    await this.sendMail({
      to,
      subject: 'Dados de acesso da sua VM — Atlashost',
      previewText: 'Seu servidor está pronto. Confira os dados de acesso.',
      html: `
        <h1>Sua VM está pronta 🚀</h1>
        <p>Olá,</p>
        <p>Seu servidor na <strong>Atlashost</strong> foi provisionado com sucesso. Abaixo estão os dados de acesso:</p>
        <p><strong>IP da VM:</strong> ${vmIp}</p>
        <p><strong>Senha:</strong> ${vmPassword}</p>
        <hr />
        <p>Por segurança, recomendamos alterar a senha no primeiro acesso.</p>
        <p>Atenciosamente,<br>Equipe Atlashost</p>
      `,
    });
  }
}
