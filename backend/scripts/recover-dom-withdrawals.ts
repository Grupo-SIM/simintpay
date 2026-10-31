/**
 * Importa saques DOM de arquivo revisado; destinatário lógico é revisado por saque.
 * Nenhuma operação altera saldo da carteira ou chama endpoint mutável da DOM.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient, type WithdrawStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type Reviewed = {
  userId: string;
  domWithdrawId: string;
  status: WithdrawStatus;
  amount: string;
  grossAmount: string;
  fee: string;
  pixKey: string;
  createdAt: string;
  platform: string | null;
};

function required(arg: string, name: string): string {
  const value = arg.split('=').slice(1).join('=');
  if (!value) throw new Error(`${name} vazio.`);
  return value;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (!['--database-name', '--admin-email', '--apply-file'].includes(key))
      throw new Error(`Argumento desconhecido: ${arg}`);
    options.set(key, required(arg, key));
  }
  const name = options.get('--database-name');
  const adminEmail = options.get('--admin-email')?.toLowerCase();
  if (!name || !adminEmail)
    throw new Error('Informe --database-name e --admin-email.');
  const applyFile = options.get('--apply-file');
  if (!applyFile) throw new Error('Informe --apply-file.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente.');
  if (decodeURIComponent(new URL(url).pathname.slice(1)) !== name)
    throw new Error('Nome do banco diverge de DATABASE_URL.');
  return { url, name, adminEmail, applyFile };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function firstString(...values: unknown[]): string | null {
  for (const value of values)
    if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function validateReviewed(value: unknown): Reviewed[] {
  if (!Array.isArray(value))
    throw new Error('Arquivo revisado deve ser um array.');
  const seen = new Set<string>();
  return value.map((item) => {
    const row = record(item);
    const userId = firstString(row.userId);
    if (!userId)
      throw new Error('Cada saque exige userId do beneficiário lógico.');
    const id = firstString(row.domWithdrawId);
    if (!id || seen.has(id)) throw new Error('ID DOM ausente ou duplicado.');
    seen.add(id);
    if (
      !['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(
        String(row.status),
      )
    )
      throw new Error(`Status inválido: ${id}`);
    for (const field of ['amount', 'grossAmount', 'fee']) {
      if (
        typeof row[field] !== 'string' ||
        !/^\d{1,10}\.\d{2}$/.test(row[field])
      )
        throw new Error(`Valor inválido em ${field}: ${id}`);
    }
    const amount = new Prisma.Decimal(row.amount as string);
    const gross = new Prisma.Decimal(row.grossAmount as string);
    const fee = new Prisma.Decimal(row.fee as string);
    if (gross.lte(0) || !amount.add(fee).eq(gross))
      throw new Error(`Bruto deve ser líquido + taxa: ${id}`);
    const pixKey = firstString(row.pixKey);
    const createdAt = firstString(row.createdAt);
    if (!pixKey || !createdAt || Number.isNaN(Date.parse(createdAt)))
      throw new Error(`Chave PIX/data inválida: ${id}`);
    if (
      row.platform !== null &&
      row.platform !== undefined &&
      (typeof row.platform !== 'string' ||
        !/^[a-z0-9_-]{1,50}$/i.test(row.platform))
    )
      throw new Error(`Plataforma inválida: ${id}`);
    return {
      userId,
      domWithdrawId: id,
      status: row.status as WithdrawStatus,
      amount: row.amount as string,
      grossAmount: row.grossAmount as string,
      fee: row.fee as string,
      pixKey,
      createdAt,
      platform:
        typeof row.platform === 'string' ? row.platform.toLowerCase() : null,
    };
  });
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: args.url,
      connectionTimeoutMillis: 10000,
    }),
  });
  try {
    const admin = await prisma.user.findUnique({
      where: { email: args.adminEmail },
      select: {
        id: true,
        email: true,
        role: true,
        isPurged: true,
        isActive: true,
      },
    });
    if (!admin || admin.role !== 'ADMIN' || admin.isPurged || !admin.isActive)
      throw new Error('Conta administradora local ausente ou inativa.');
    const source = record(JSON.parse(readFileSync(args.applyFile!, 'utf8')));
    if (source.adminUserId !== admin.id)
      throw new Error('Arquivo revisado pertence a outro admin.');
    const rows = validateReviewed(source.withdraws);
    const beneficiaries = [...new Set(rows.map((row) => row.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: beneficiaries }, isActive: true, isPurged: false },
      select: { id: true },
    });
    if (users.length !== beneficiaries.length)
      throw new Error(
        'Beneficiário lógico ausente/inativo em um ou mais saques.',
      );
    const result = await prisma.$transaction(
      async (tx) => {
        let created = 0;
        let existing = 0;
        for (const row of rows) {
          const match = await tx.withdrawRequest.findUnique({
            where: { domWithdrawId: row.domWithdrawId },
            select: {
              userId: true,
              amount: true,
              grossAmount: true,
              fee: true,
              status: true,
            },
          });
          if (match) {
            if (
              match.userId !== row.userId ||
              !match.amount.eq(row.amount) ||
              !match.grossAmount.eq(row.grossAmount) ||
              !match.fee.eq(row.fee) ||
              match.status !== row.status
            )
              throw new Error(
                `Saque existente diverge; lote revertido: ${row.domWithdrawId}`,
              );
            existing++;
            continue;
          }
          await tx.withdrawRequest.create({
            data: {
              userId: row.userId,
              domWithdrawId: row.domWithdrawId,
              amount: row.amount,
              grossAmount: row.grossAmount,
              fee: row.fee,
              status: row.status,
              pixKey: row.pixKey,
              platform: row.platform,
              createdAt: new Date(row.createdAt),
              reviewSource: 'DOM_RECOVERY_REVIEWED',
            },
          });
          created++;
        }
        return { created, existing };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120000,
      },
    );
    console.log(JSON.stringify({ ...result, walletChanged: false }));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('/recover-dom-withdrawals.ts'))
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Falha desconhecida.',
    );
    process.exitCode = 1;
  });
