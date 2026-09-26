/**
 * Reconstrói apenas dados cuja identidade é comprovada pelas transações locais.
 * Simulação por padrão. Não consulta a DOM nem altera saldos financeiros.
 *
 * bun scripts/recover-from-transactions.ts --database-name=simpay
 * bun scripts/recover-from-transactions.ts --database-name=simpay --apply
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';

const platformByTenant: Record<string, string> = {
  EBOOK: 'ebook', EBOOKSIM: 'ebook', RENOVADA: 'renovada', REVALIDA: 'revalida',
  BOSQUE: 'bosque', PAGATG: 'pagatg', FRENDZ: 'frendz', ATLAS: 'atlas',
};
const batchSize = 500;
const zero = new Prisma.Decimal(0);

export function ownerFromDescription(description: string | null): {
  document: string; platform: string; name: string | null;
} | null {
  const text = description ?? '';
  const tenant = /\[TENANT:([A-Z0-9_]+)\]/i.exec(text)?.[1]?.toUpperCase();
  const cpf = /\[CPF_DONO:(\d{11})\]/i.exec(text)?.[1];
  const cnpj = /\[CNPJ_DONO:(\d{14})\]/i.exec(text)?.[1];
  const platform = tenant ? platformByTenant[tenant] : undefined;
  if (!platform || (!cpf && !cnpj) || (cpf && cnpj)) return null;
  return {
    document: cpf ?? cnpj!, platform,
    name: /\[NOME_DONO:([^\]]+)\]/i.exec(text)?.[1]?.trim() || null,
  };
}

export function customerFromTransaction(row: {
  userId: string; customerDocument: string | null; customerName: string | null;
  customerEmail: string | null; customerPhone: string | null;
}): { userId: string; document: string; name: string; email: string; phone: string | null; documentType: string } | null {
  const document = (row.customerDocument ?? '').replace(/\D/g, '');
  const name = row.customerName?.trim();
  const email = row.customerEmail?.trim().toLowerCase();
  if (![11, 14].includes(document.length) || !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { userId: row.userId, document, name, email, phone: row.customerPhone?.trim() || null,
    documentType: document.length === 14 ? 'CNPJ' : 'CPF' };
}

function parseArgs(argv: string[]) {
  const allowed = new Set(['--apply']);
  let databaseName = '';
  let balancesFile: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--database-name=')) databaseName = arg.slice('--database-name='.length);
    else if (arg.startsWith('--balances-file=')) balancesFile = arg.slice('--balances-file='.length);
    else if (!allowed.has(arg)) throw new Error(`Argumento desconhecido: ${arg}`);
  }
  const apply = argv.includes('--apply');
  if (!databaseName) throw new Error('Informe --database-name=<nome do banco> para evitar conexão acidental.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente.');
  const actualName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (actualName !== databaseName) throw new Error(`Banco esperado ${databaseName}; conexão aponta para ${actualName}.`);
  return { apply, url, databaseName, balancesFile };
}

export function parseBalances(value: unknown): Array<{
  userId: string; expectedBalance: string; expectedLockedBalance: string;
  balance: string; lockedBalance: string;
}> {
  if (!Array.isArray(value)) throw new Error('Arquivo de saldos deve conter um array.');
  const seen = new Set<string>();
  return value.map(row => {
    if (!row || typeof row.userId !== 'string' || !row.userId || seen.has(row.userId))
      throw new Error('userId ausente ou duplicado no arquivo de saldos.');
    seen.add(row.userId);
    for (const field of ['expectedBalance', 'expectedLockedBalance', 'balance', 'lockedBalance']) {
      if (typeof row[field] !== 'string' || !/^-?\d{1,10}\.\d{2}$/.test(row[field]))
        throw new Error(`Saldo inválido: ${field}; use string decimal com duas casas.`);
    }
    if (new Prisma.Decimal(row.lockedBalance).lt(0)) throw new Error('Saldo bloqueado não pode ser negativo.');
    return { userId: row.userId, expectedBalance: row.expectedBalance,
      expectedLockedBalance: row.expectedLockedBalance, balance: row.balance, lockedBalance: row.lockedBalance };
  });
}

async function main() {
  const { apply, url, databaseName, balancesFile } = parseArgs(process.argv.slice(2));
  const balances = balancesFile ? parseBalances(JSON.parse(readFileSync(balancesFile, 'utf8'))) : [];
  const endpoint = new URL(url);
  const target = `${endpoint.hostname}:${endpoint.port || '5432'}/${databaseName}`;
  console.log(`Destino PostgreSQL: ${target} (${apply ? 'gravação autorizada por --apply' : 'somente leitura'})`);
  // Bun pode carregar classes Pool diferentes via ESM/CJS. PrismaPg usa
  // instanceof para distinguir Pool de configuração; passar Pool pode perder
  // connectionString e conectar ao localhost. Configuração evita essa ambiguidade.
  const prisma = new PrismaClient({ adapter: new PrismaPg({
    connectionString: url, connectionTimeoutMillis: 10000,
  }) });
  const counters = { transactions: 0, customersEligible: 0, customersIncomplete: 0,
    ownersEligible: 0, ownerRowsIncomplete: 0, walletsEligible: 0,
    customersCreated: 0, customerConflicts: 0, ownersCreated: 0, ownersLinked: 0,
    walletsCreated: 0, externalWalletsCreated: 0 };
  const customers = new Map<string, NonNullable<ReturnType<typeof customerFromTransaction>>>();
  const customerConflicts = new Set<string>();
  const owners = new Map<string, NonNullable<ReturnType<typeof ownerFromDescription>>>();
  const userIds = new Set<string>();
  const ownerRevenue = new Map<string, { net: Prisma.Decimal; missingNet: number; completed: number }>();
  try {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'CONNECTION_ERROR';
      throw new Error(`Falha ao conectar a ${target} (${code}). Nenhuma gravação realizada. ` +
        'Confira host/porta de DATABASE_URL, serviço PostgreSQL e acesso à rede/VPN/túnel. ' +
        'Em Docker, use a porta publicada no host ou execute no ambiente com acesso à rede do banco.');
    }
    // Cursor estável: evita OFFSET em tabelas grandes e não carrega todas as transações em memória.
    let cursor: string | undefined;
    while (true) {
      const rows = await prisma.transaction.findMany({
        take: batchSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, userId: true, customerDocument: true, customerName: true,
          customerEmail: true, customerPhone: true, description: true, status: true, netAmount: true },
      });
      if (!rows.length) break;
      for (const row of rows) {
        counters.transactions++;
        userIds.add(row.userId);
        const customer = customerFromTransaction(row);
        if (customer) {
          const key = `${customer.userId}:${customer.document}`;
          const previous = customers.get(key);
          if (previous && (previous.email !== customer.email || previous.name !== customer.name))
            customerConflicts.add(key);
          customers.set(key, customer);
          counters.customersEligible++;
        } else if (row.customerDocument || row.customerName || row.customerEmail) counters.customersIncomplete++;
        const owner = ownerFromDescription(row.description);
        if (owner) {
          const key = `${owner.platform}:${owner.document}`;
          const previous = owners.get(key);
          owners.set(key, { ...owner, name: owner.name ?? previous?.name ?? null });
          counters.ownersEligible++;
          if (row.status === 'COMPLETED') {
            const revenue = ownerRevenue.get(key) ?? { net: zero, missingNet: 0, completed: 0 };
            revenue.completed++;
            if (row.netAmount == null) revenue.missingNet++;
            else revenue.net = revenue.net.add(row.netAmount);
            ownerRevenue.set(key, revenue);
          }
        } else if (/\[(?:CPF|CNPJ)_DONO:/i.test(row.description ?? '')) counters.ownerRowsIncomplete++;
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < batchSize) break;
    }

    const ownerPlan: Array<{ key: string; document: string; platform: string; name: string; userId: string | null;
      existingId: string | null; needsLink: boolean; needsWallet: boolean; purged: boolean }> = [];
    for (const [key, owner] of owners) {
      const isCnpj = owner.document.length === 14;
      const [existing, user] = await Promise.all([
        prisma.externalPlatformUser.findFirst({ where: { platform: owner.platform,
          ...(isCnpj ? { cnpj: owner.document } : { cpf: owner.document }) }, include: { wallet: true } }),
        prisma.user.findFirst({ where: isCnpj ? { cnpj: owner.document } : { cpf: owner.document }, select: { id: true, name: true } }),
      ]);
      ownerPlan.push({ key, document: owner.document, platform: owner.platform,
        name: user?.name?.trim() || owner.name || `${isCnpj ? 'CNPJ' : 'CPF'} ${owner.document}`,
        userId: user?.id ?? null, existingId: existing?.id ?? null,
        needsLink: !!(existing && user && !existing.userId && !existing.isPurged && !existing.isDeleted),
        needsWallet: !existing?.wallet, purged: !!(existing?.isPurged || existing?.isDeleted) });
    }
    const customerKeys = new Set<string>();
    const customerUserIds = [...new Set([...customers.values()].map(c => c.userId))];
    for (let offset = 0; offset < customerUserIds.length; offset += batchSize) {
      const existing = await prisma.customer.findMany({
        where: { userId: { in: customerUserIds.slice(offset, offset + batchSize) } },
        select: { userId: true, document: true },
      });
      for (const row of existing) customerKeys.add(`${row.userId}:${row.document.replace(/\D/g, '')}`);
    }
    counters.customerConflicts = customerConflicts.size;
    const customerCreates = [...customers].filter(([key]) => !customerKeys.has(key) && !customerConflicts.has(key)).map(([, c]) => c);
    const walletUserIds = new Set<string>();
    const allUserIds = [...userIds];
    for (let offset = 0; offset < allUserIds.length; offset += batchSize) {
      const existing = await prisma.wallet.findMany({
        where: { userId: { in: allUserIds.slice(offset, offset + batchSize) } }, select: { userId: true },
      });
      for (const row of existing) walletUserIds.add(row.userId);
    }
    const walletCreates = [...userIds].filter(id => !walletUserIds.has(id));
    counters.walletsEligible = walletCreates.length;

    // Relatório financeiro: receita conhecida; não vira saldo automaticamente.
    // Saques sem plataforma não podem ser atribuídos a uma carteira externa.
    const linkedUserIds = [...new Set(ownerPlan.map(o => o.userId).filter((id): id is string => !!id))];
    const withdrawals: Array<{ userId: string; platform: string | null; status: string; grossAmount: Prisma.Decimal }> = [];
    const charges: Array<{ userId: string; amount: Prisma.Decimal }> = [];
    for (let offset = 0; offset < linkedUserIds.length; offset += batchSize) {
      const ids = linkedUserIds.slice(offset, offset + batchSize);
      const [userWithdrawals, userCharges] = await Promise.all([
        prisma.withdrawRequest.findMany({ where: { userId: { in: ids } },
          select: { userId: true, platform: true, status: true, grossAmount: true } }),
        prisma.cobranca.findMany({ where: { userId: { in: ids }, mode: 'DEBIT', status: 'APPLIED' },
          select: { userId: true, amount: true } }),
      ]);
      withdrawals.push(...userWithdrawals);
      charges.push(...userCharges);
    }
    const chargesByUser = new Map<string, Prisma.Decimal>();
    for (const charge of charges) chargesByUser.set(charge.userId,
      (chargesByUser.get(charge.userId) ?? zero).add(charge.amount));
    const financial = ownerPlan.map(owner => {
      const revenue = ownerRevenue.get(owner.key);
      const scoped = withdrawals.filter(w => w.userId === owner.userId && w.platform?.toLowerCase() === owner.platform);
      const unknown = withdrawals.filter(w => w.userId === owner.userId && !w.platform && w.status !== 'REJECTED').length;
      const debited = scoped.filter(w => w.status === 'APPROVED' || w.status === 'COMPLETED')
        .reduce((sum, w) => sum.add(w.grossAmount), zero);
      const locked = scoped.filter(w => w.status === 'PENDING')
        .reduce((sum, w) => sum.add(w.grossAmount), zero);
      return { platform: owner.platform, documentSuffix: owner.document.slice(-4),
        completed: revenue?.completed ?? 0, knownNet: revenue?.net.toFixed(2) ?? '0.00',
        missingNet: revenue?.missingNet ?? 0, scopedDebits: debited.toFixed(2),
        scopedPending: locked.toFixed(2), unscopedWithdrawals: unknown,
        userChargesUnallocated: (chargesByUser.get(owner.userId ?? '') ?? zero).toFixed(2),
        status: owner.purged ? 'EXCLUDED' : 'REVIEW_REQUIRED' };
    });

    // Valida todos os saldos revisados antes de qualquer criação.
    for (const row of balances) {
      const user = await prisma.user.findUnique({ where: { id: row.userId }, include: { wallet: true } });
      if (!user || user.isPurged || !user.isActive) throw new Error(`Conta indisponível para saldo: ${row.userId}`);
      const before = user.wallet;
      const alreadyApplied = before?.balance.eq(row.balance) && before.lockedBalance.eq(row.lockedBalance);
      if (!alreadyApplied && (!(before?.balance ?? zero).eq(row.expectedBalance) ||
        !(before?.lockedBalance ?? zero).eq(row.expectedLockedBalance)))
        throw new Error(`Saldo atual diverge do arquivo revisado: ${row.userId}`);
    }

    console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', databaseName,
      summary: { ...counters, uniqueCustomers: customers.size, newCustomers: customerCreates.length,
        uniqueOwners: ownerPlan.length, newOwners: ownerPlan.filter(o => !o.existingId).length,
        newExternalWallets: ownerPlan.filter(o => o.needsWallet && !o.purged).length },
      financial, reviewedBalances: balances }, null, 2));

    if (!apply) return;
    // Criações idempotentes. Carteiras novas começam em zero: saldo desconhecido
    // nunca é transformado em crédito sacável por uma estimativa incompleta.
    for (let offset = 0; offset < customerCreates.length; offset += batchSize) {
      const result = await prisma.customer.createMany({ data: customerCreates.slice(offset, offset + batchSize), skipDuplicates: true });
      counters.customersCreated += result.count;
    }
    for (const owner of ownerPlan) {
      if (owner.purged) continue;
      const isCnpj = owner.document.length === 14;
      const created = await prisma.externalPlatformUser.createMany({ data: [{
        platform: owner.platform, name: owner.name, userId: owner.userId,
        ...(isCnpj ? { cnpj: owner.document } : { cpf: owner.document }),
      }], skipDuplicates: true });
      counters.ownersCreated += created.count;
      const existing = await prisma.externalPlatformUser.findFirst({ where: { platform: owner.platform,
        ...(isCnpj ? { cnpj: owner.document } : { cpf: owner.document }) }, select: { id: true, isPurged: true, isDeleted: true } });
      if (!existing || existing.isPurged || existing.isDeleted) continue;
      if (owner.userId) {
        const linked = await prisma.externalPlatformUser.updateMany({ where: { id: existing.id, userId: null },
          data: { userId: owner.userId } });
        counters.ownersLinked += linked.count;
      }
      const wallet = await prisma.externalPlatformWallet.createMany({
        data: [{ externalUserId: existing.id, balance: zero, lockedBalance: zero }], skipDuplicates: true,
      });
      counters.externalWalletsCreated += wallet.count;
    }
    for (let offset = 0; offset < walletCreates.length; offset += batchSize) {
      const result = await prisma.wallet.createMany({ data: walletCreates.slice(offset, offset + batchSize)
        .map(userId => ({ userId, balance: zero, lockedBalance: zero })), skipDuplicates: true });
      counters.walletsCreated += result.count;
    }
    if (balances.length) await prisma.$transaction(async tx => {
      for (const row of balances) {
        const wallet = await tx.wallet.findUnique({ where: { userId: row.userId } });
        if (wallet?.balance.eq(row.balance) && wallet.lockedBalance.eq(row.lockedBalance)) continue;
        if (!wallet) throw new Error(`Carteira ausente: ${row.userId}. Rode recuperação sem arquivo de saldos primeiro.`);
        const changed = await tx.wallet.updateMany({ where: { userId: row.userId,
          version: wallet.version, balance: new Prisma.Decimal(row.expectedBalance),
          lockedBalance: new Prisma.Decimal(row.expectedLockedBalance) },
          data: { balance: new Prisma.Decimal(row.balance), lockedBalance: new Prisma.Decimal(row.lockedBalance),
            version: { increment: 1 } } });
        if (changed.count !== 1) throw new Error(`Conflito de saldo: ${row.userId}; operação de saldos revertida.`);
        await tx.balanceLog.create({ data: { userId: row.userId, action: 'RECOVERY_REVIEWED_BALANCE',
          amount: new Prisma.Decimal(row.balance).sub(wallet.balance), balanceBefore: wallet.balance,
          balanceAfter: new Prisma.Decimal(row.balance), lockedBefore: wallet.lockedBalance,
          lockedAfter: new Prisma.Decimal(row.lockedBalance), source: 'LOCAL_RECOVERY',
          description: 'Saldo recuperado de arquivo revisado pelo operador; não inferido de receita parcial.' } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
    console.log(JSON.stringify({ applied: counters }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Falha inesperada na recuperação.');
  process.exitCode = 1;
});
