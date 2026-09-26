/**
 * Exporta saques da conta administradora DOM; destinatário lógico é revisado por saque.
 * Nenhuma operação altera saldo da carteira ou chama endpoint mutável da DOM.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { Prisma, PrismaClient, type WithdrawStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { request } from 'node:https';
import { rootCertificates } from 'node:tls';

type Reviewed = {
  userId: string; domWithdrawId: string; status: WithdrawStatus; amount: string;
  grossAmount: string; fee: string; pixKey: string; createdAt: string;
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
    if (!['--database-name', '--admin-email', '--token-env', '--output', '--apply-file'].includes(key))
      throw new Error(`Argumento desconhecido: ${arg}`);
    options.set(key, required(arg, key));
  }
  const name = options.get('--database-name');
  const adminEmail = options.get('--admin-email')?.toLowerCase();
  if (!name || !adminEmail) throw new Error('Informe --database-name e --admin-email.');
  const output = options.get('--output');
  const applyFile = options.get('--apply-file');
  if (!!output === !!applyFile) throw new Error('Escolha exatamente um: --output ou --apply-file.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente.');
  if (decodeURIComponent(new URL(url).pathname.slice(1)) !== name) throw new Error('Nome do banco diverge de DATABASE_URL.');
  if (output && !options.get('--token-env')) throw new Error('Informe --token-env=DOM_TOKEN.');
  return { url, name, adminEmail, output, applyFile, tokenEnv: options.get('--token-env') };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function mapDomWithdrawalStatus(value: string): WithdrawStatus | null {
  const status = value.trim().toLowerCase();
  if (['approved', 'paid', 'completed', 'success', 'ok', 'pago', 'aprovado'].includes(status)) return 'APPROVED';
  if (['rejected', 'cancelled', 'canceled', 'error', 'failed', 'rejeitado', 'cancelado'].includes(status)) return 'REJECTED';
  if (['pending', 'processing', 'created', 'pendente'].includes(status)) return 'PENDING';
  return null;
}

export function reachedDomWithdrawalEnd(page: number, received: number,
  totalPages: number, totalResults: number, batchLength: number): boolean {
  if (batchLength === 0) return true;
  return totalResults > 0 && received >= totalResults &&
    (totalPages <= 0 || page >= totalPages);
}

export function validateReviewed(value: unknown): Reviewed[] {
  if (!Array.isArray(value)) throw new Error('Arquivo revisado deve ser um array.');
  const seen = new Set<string>();
  return value.map(item => {
    const row = record(item);
    const userId = firstString(row.userId);
    if (!userId) throw new Error('Cada saque exige userId do beneficiário lógico.');
    const id = firstString(row.domWithdrawId);
    if (!id || seen.has(id)) throw new Error('ID DOM ausente ou duplicado.');
    seen.add(id);
    if (!['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(String(row.status)))
      throw new Error(`Status inválido: ${id}`);
    for (const field of ['amount', 'grossAmount', 'fee']) {
      if (typeof row[field] !== 'string' || !/^\d{1,10}\.\d{2}$/.test(row[field]))
        throw new Error(`Valor inválido em ${field}: ${id}`);
    }
    const amount = new Prisma.Decimal(row.amount as string);
    const gross = new Prisma.Decimal(row.grossAmount as string);
    const fee = new Prisma.Decimal(row.fee as string);
    if (gross.lte(0) || !amount.add(fee).eq(gross)) throw new Error(`Bruto deve ser líquido + taxa: ${id}`);
    const pixKey = firstString(row.pixKey);
    const createdAt = firstString(row.createdAt);
    if (!pixKey || !createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error(`Chave PIX/data inválida: ${id}`);
    if (row.platform !== null && row.platform !== undefined &&
      (typeof row.platform !== 'string' || !/^[a-z0-9_-]{1,50}$/i.test(row.platform)))
      throw new Error(`Plataforma inválida: ${id}`);
    return { userId, domWithdrawId: id, status: row.status as WithdrawStatus,
      amount: row.amount as string, grossAmount: row.grossAmount as string,
      fee: row.fee as string, pixKey, createdAt,
      platform: typeof row.platform === 'string' ? row.platform.toLowerCase() : null };
  });
}

async function domGet(path: string, token: string, base: string): Promise<unknown> {
  const url = new URL(`${base.replace(/\/$/, '')}${path}`);
  if (url.protocol !== 'https:') throw new Error('Token DOM exige HTTPS.');
  const caFile = process.env.DOM_CA_FILE;
  const ca = caFile ? [...rootCertificates, readFileSync(caFile, 'utf8')] : undefined;
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', ca, rejectUnauthorized: true,
      headers: { Authorization: `Bearer ${token}`, 'x-access-token': token, Accept: 'application/json' },
    }, response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`DOM HTTP ${response.statusCode} em ${url.hostname}${url.pathname}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Resposta DOM não contém JSON válido.')); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Tempo limite DOM excedido.')), 20000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', error => {
      const code = (error as NodeJS.ErrnoException).code;
      reject(new Error(`Falha HTTPS em ${url.hostname}:${url.port || '443'} (${code || error.message}). ` +
        'Se falha for de certificado, confira cadeia TLS do servidor; para CA privada/proxy, use DOM_CA_FILE=/caminho/ca-confiavel.pem.'));
    });
    req.end();
  });
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient({ adapter: new PrismaPg({
    connectionString: args.url, connectionTimeoutMillis: 10000,
  }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email: args.adminEmail },
      select: { id: true, email: true, role: true, isPurged: true, isActive: true } });
    if (!admin || admin.role !== 'ADMIN' || admin.isPurged || !admin.isActive)
      throw new Error('Conta administradora local ausente ou inativa.');
    if (args.output) {
      const token = process.env[args.tokenEnv!];
      if (!token) throw new Error(`Token ausente em ${args.tokenEnv}.`);
      const base = process.env.DOM_PAYMENTS_API_URL ?? 'https://api-dom.jbmidia.com/payments';
      const rows: unknown[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= 1000; page++) {
        const result = record(await domGet(`/withdrawals?limit=100&page=${page}`, token, base));
        const batch = [result.withdrawals, result.withdraws, result.pixouts, result.data]
          .find(Array.isArray) as unknown[] | undefined;
        if (!batch) throw new Error('Resposta DOM sem lista de saques.');
        if (!batch.length) break;
        for (const item of batch) {
          const raw = record(item);
          const withdrawId = firstString(raw.id, raw.id_transfer);
          if (!withdrawId || seen.has(withdrawId)) throw new Error('Saque DOM sem ID ou repetido entre páginas.');
          seen.add(withdrawId);
          const existing = await prisma.withdrawRequest.findUnique({ where: { domWithdrawId: withdrawId },
            select: { id: true, userId: true, status: true } });
          rows.push({ domWithdrawId: withdrawId, rawValue: raw.amount ?? raw.value ?? null,
            rawStatus: raw.status ?? null, suggestedStatus: mapDomWithdrawalStatus(String(raw.status ?? '')),
            pixKey: firstString(raw.pixKey, raw.pix_key, raw.recipient_key),
            createdAt: firstString(raw.createdAt, raw.created_at, raw.create_date),
            existing: existing ? { userId: existing.userId, status: existing.status } : null });
        }
        const totalPages = Number(result.total_pages ?? 0);
        const totalResults = Number(result.total_results ?? result.total ?? 0);
        if (reachedDomWithdrawalEnd(page, rows.length, totalPages, totalResults, batch.length)) break;
        if (page === 1000) throw new Error('Limite de páginas DOM atingido.');
      }
      writeFileSync(args.output, JSON.stringify({ adminUserId: admin.id, adminEmail: admin.email,
        note: 'Atribua userId beneficiário por saque; revise bruto, líquido, taxa, unidade e plataforma. Saldo não é alterado.',
        withdraws: rows }, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ exported: rows.length, file: args.output, adminUserId: admin.id }));
      return;
    }
    const source = record(JSON.parse(readFileSync(args.applyFile!, 'utf8')));
    if (source.adminUserId !== admin.id) throw new Error('Arquivo revisado pertence a outro admin.');
    const rows = validateReviewed(source.withdraws);
    const beneficiaries = [...new Set(rows.map(row => row.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: beneficiaries }, isActive: true, isPurged: false },
      select: { id: true } });
    if (users.length !== beneficiaries.length) throw new Error('Beneficiário lógico ausente/inativo em um ou mais saques.');
    const result = await prisma.$transaction(async tx => {
      let created = 0;
      let existing = 0;
      for (const row of rows) {
        const match = await tx.withdrawRequest.findUnique({ where: { domWithdrawId: row.domWithdrawId },
          select: { userId: true, amount: true, grossAmount: true, fee: true, status: true } });
        if (match) {
          if (match.userId !== row.userId || !match.amount.eq(row.amount) ||
            !match.grossAmount.eq(row.grossAmount) || !match.fee.eq(row.fee) || match.status !== row.status)
            throw new Error(`Saque existente diverge; lote revertido: ${row.domWithdrawId}`);
          existing++;
          continue;
        }
        await tx.withdrawRequest.create({ data: { userId: row.userId,
          domWithdrawId: row.domWithdrawId, amount: row.amount, grossAmount: row.grossAmount,
          fee: row.fee, status: row.status, pixKey: row.pixKey, platform: row.platform,
          createdAt: new Date(row.createdAt), reviewSource: 'DOM_RECOVERY_REVIEWED' } });
        created++;
      }
      return { created, existing };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 });
    console.log(JSON.stringify({ ...result, walletChanged: false }));
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1]?.endsWith('/recover-dom-withdrawals.ts')) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Falha desconhecida.');
  process.exitCode = 1;
});
