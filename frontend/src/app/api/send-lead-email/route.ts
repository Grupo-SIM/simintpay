import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

const RECIPIENT = 'brenohslima@gmail.com';

const labelMap: Record<string, string> = {
  name: 'Nome',
  phone: 'Telefone',
  email: 'E-mail',
  razaoSocial: 'Razão Social',
  cnpj: 'CNPJ',
  faturamento: 'Faturamento',
  tempoOperacao: 'Tempo de Operação',
  modeloOperacao: 'Modelo de Operação',
  cargo: 'Cargo',
  comoConheceu: 'Como Conheceu',
};

const valueMap: Record<string, Record<string, string>> = {
  faturamento: {
    ATE_10K: 'Até R$ 10.000',
    DE_10K_A_50K: 'De R$ 10.000 a R$ 50.000',
    DE_50K_A_100K: 'De R$ 50.000 a R$ 100.000',
    DE_100K_A_500K: 'De R$ 100.000 a R$ 500.000',
    ACIMA_500K: 'Acima de R$ 500.000',
  },
  tempoOperacao: {
    MENOS_1_ANO: 'Menos de 1 ano',
    DE_1_A_3_ANOS: 'De 1 a 3 anos',
    DE_3_A_5_ANOS: 'De 3 a 5 anos',
    MAIS_5_ANOS: 'Mais de 5 anos',
  },
  modeloOperacao: {
    ECOMMERCE: 'E-commerce',
    PRESENCIAL: 'Presencial',
    AMBOS: 'Ambos',
    SERVICOS: 'Serviços',
    ASSINATURAS: 'Assinaturas',
  },
  cargo: {
    SOCIO: 'Sócio/Proprietário',
    DIRETOR: 'Diretor',
    GERENTE: 'Gerente',
    FINANCEIRO: 'Financeiro',
    TI: 'TI',
    OUTRO: 'Outro',
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const rows = Object.entries(labelMap)
      .map(([key, label]) => {
        const raw = body[key];
        const value = (valueMap[key]?.[raw] ?? raw) || 'Não informado';
        return `<tr>
          <td style="padding:8px 12px;font-weight:600;background:#f5f5f5;border:1px solid #e0e0e0;white-space:nowrap">${label}</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0">${value}</td>
        </tr>`;
      })
      .join('');

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="background:#7c3aed;color:#fff;padding:16px 20px;margin:0;border-radius:8px 8px 0 0">
          Nova solicitação de cadastro
        </h2>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          ${rows}
        </table>
        <p style="color:#888;font-size:12px;margin-top:16px">
          Enviado automaticamente pelo formulário de cadastro da SIM INT PAY.
        </p>
      </div>
    `;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.sendMail({
      from: `"SIM INT PAY" <${process.env.SMTP_FROM_EMAIL}>`,
      to: RECIPIENT,
      subject: `Nova solicitação de cadastro – ${body.name ?? 'sem nome'}`,
      html,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-lead-email]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
