import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

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
        from: `"SimPay" <${from}>`,
        to: input.to,
        subject: `Acesso liberado: ${input.linkName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SimPay</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.customerName}</strong>!</p>
              <p>Sua assinatura <strong style="color: #6d28d9;">${input.linkName}</strong> foi confirmada com sucesso.</p>
              ${accessButton}
              <hr style="border: none; border-top: 1px solid #e5e3ff; margin: 24px 0;" />
              <p style="font-size: 12px; color: #9ca3af;">ID da assinatura: ${input.orderId}</p>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SimPay · JB Mídia
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail de acesso de assinatura para ${input.to}: ${String(err)}`);
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
        from: `"SimPay" <${from}>`,
        to: input.to,
        subject: 'Bem-vindo ao SimPay — sua conta foi criada',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e1b4b;">
            <div style="background: #0f0c1e; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #a78bfa; margin: 0; font-size: 22px;">SimPay</h1>
            </div>
            <div style="background: #f8f7ff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e3ff;">
              <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${input.name}</strong>!</p>
              <p>Sua solicitação de cadastro foi <strong style="color: #6d28d9;">aprovada</strong>. Seu acesso ao SimPay está pronto.</p>

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
                Acessar o SimPay
              </a>
            </div>
            <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
              SimPay · JB Mídia
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail de boas-vindas para ${input.to}: ${String(err)}`);
      // Don't throw — email failure shouldn't roll back the approval
    }
  }
}
