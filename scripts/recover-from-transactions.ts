/**
 * Reconstrói cadastros comprovados por transações, backup User ou lead aprovado.
 * Simulação por padrão. Consulta DOM só com --dom; não estima saldos financeiros.
 *
 * bun scripts/recover-from-transactions.ts --database-name=simpay
 * bun scripts/recover-from-transactions.ts --database-name=simpay --apply
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { hash } from 'bcryptjs';
import { domPatch, provenUser, readDomDetail, usersFromBackup, type ProvenUser } from './recovery-sources';

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
  let backupFile: string | undefined;
  let useDom = false;
  for (const arg of argv) {
    if (arg.startsWith('--database-name=')) databaseName = arg.slice('--database-name='.length);
    else if (arg.startsWith('--balances-file=')) balancesFile = arg.slice('--balances-file='.length);
    else if (arg.startsWith('--backup-file=')) backupFile = arg.slice('--backup-file='.length);
    else if (arg === '--dom') useDom = true;
    else if (!allowed.has(arg)) throw new Error(`Argumento desconhecido: ${arg}`);
  }
  const apply = argv.includes('--apply');
  if (!databaseName) throw new Error('Informe --database-name=<nome do banco> para evitar conexão acidental.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente.');
  const actualName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (actualName !== databaseName) throw new Error(`Banco esperado ${databaseName}; conexão aponta para ${actualName}.`);
  if (useDom && !(process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY))
    throw new Error('DOM_TOKEN/API_DOM_MASTER_KEY ausente.');
  return { apply, url, databaseName, balancesFile, backupFile, useDom };
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
  const { apply, url, databaseName, balancesFile, backupFile, useDom } = parseArgs(process.argv.slice(2));
  const balances = balancesFile ? parseBalances(JSON.parse(readFileSync(balancesFile, 'utf8'))) : [];
  const backupUsers = backupFile ? await usersFromBackup(backupFile) : [];
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
    walletsCreated: 0, externalWalletsCreated: 0, usersCreated: 0,
    domChecked: 0, domEnriched: 0, domErrors: 0 };
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
    const proven = new Map<string, ProvenUser>();
    for (const user of backupUsers) {
      if (proven.has(user.id)) throw new Error(`ID duplicado no backup: ${user.id}`);
      proven.set(user.id, user);
    }
    const approvedLeads = await prisma.lead.findMany({
      where: { status: 'APPROVED', approvedUserId: { not: null } },
      select: { approvedUserId: true, name: true, email: true, cpf: true, cnpj: true },
    });
    for (const lead of approvedLeads) {
      if (!lead.approvedUserId || proven.has(lead.approvedUserId)) continue;
      try {
        proven.set(lead.approvedUserId, provenUser({
          id: lead.approvedUserId, name: lead.name, email: lead.email,
          cpf: lead.cpf, cnpj: lead.cnpj, clientStatus: 'APPROVED',
        }, 'APPROVED_LEAD'));
      } catch { /* Leave invalid source for manual review. */ }
    }
    const newUsers: ProvenUser[] = [];
    const skippedUsers: Array<{ id: string; reason: string }> = [];
    for (const candidate of proven.values()) {
      const existing = await prisma.user.findFirst({ where: { OR: [
        { id: candidate.id }, { email: { equals: candidate.email, mode: 'insensitive' } },
        ...(candidate.cpf ? [{ cpf: candidate.cpf }] : []),
        ...(candidate.cnpj ? [{ cnpj: candidate.cnpj }] : []),
        ...(candidate.domUserId ? [{ domUserId: candidate.domUserId }] : []),
      ] }, select: { id: true, email: true } });
      if (existing) {
        if (existing.id !== candidate.id || existing.email.toLowerCase() !== candidate.email)
          skippedUsers.push({ id: candidate.id, reason: 'identidade conflita com conta existente' });
        continue;
      }
      if (candidate.role === 'ADMIN' || !candidate.isActive) {
        skippedUsers.push({ id: candidate.id, reason: 'conta admin ou inativa exige recuperação individual' });
        continue;
      }
      newUsers.push(candidate);
    }
    if (apply && newUsers.length && !process.env.RECOVERY_INITIAL_PASSWORD)
      throw new Error('RECOVERY_INITIAL_PASSWORD ausente; necessário para recriar contas comprovadas.');
    const uniqueEmails = new Set<string>();
    const uniqueDocuments = new Set<string>();
    for (const candidate of newUsers) {
      if (uniqueEmails.has(candidate.email)) throw new Error(`E-mail duplicado entre candidatos: ${candidate.email}`);
      uniqueEmails.add(candidate.email);
      for (const doc of [candidate.cpf, candidate.cnpj]) if (doc) {
        if (uniqueDocuments.has(doc)) throw new Error('Documento duplicado entre candidatos.');
        uniqueDocuments.add(doc);
      }
    }
    for (const candidate of newUsers) userIds.add(candidate.id);
    const domPatches = new Map<string, Prisma.TransactionUpdateInput>();
    if (useDom) {
      const token = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY || '';
      let domCursor: string | undefined;
      while (true) {
        const rows = await prisma.transaction.findMany({
          take: batchSize, ...(domCursor ? { cursor: { id: domCursor }, skip: 1 } : {}),
          orderBy: { id: 'asc' }, where: { acquirer: 'DOM',
            OR: [{ customerName: null }, { customerEmail: null }, { customerDocument: null },
              { customerPhone: null }, { description: null }, { netAmount: null }] },
          select: { id: true, domTransactionId: true, domPaymentId: true, amount: true,
            netAmount: true, description: true, customerName: true, customerEmail: true,
            customerDocument: true, customerPhone: true },
        });
        if (!rows.length) break;
        for (const row of rows) {
          const externalId = row.domTransactionId || row.domPaymentId;
          if (!externalId) continue;
          counters.domChecked++;
          try {
            const patch = domPatch(row, await readDomDetail(externalId, token));
            if (Object.keys(patch).length) { domPatches.set(row.id, patch); counters.domEnriched++; }
          } catch { counters.domErrors++; }
        }
        domCursor = rows[rows.length - 1].id;
        if (rows.length < batchSize) break;
      }
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
        const patch = domPatches.get(row.id);
        const patched = {
          ...row,
          customerName: typeof patch?.customerName === 'string' ? patch.customerName : row.customerName,
          customerEmail: typeof patch?.customerEmail === 'string' ? patch.customerEmail : row.customerEmail,
          customerDocument: typeof patch?.customerDocument === 'string' ? patch.customerDocument : row.customerDocument,
          customerPhone: typeof patch?.customerPhone === 'string' ? patch.customerPhone : row.customerPhone,
          description: typeof patch?.description === 'string' ? patch.description : row.description,
          netAmount: patch?.netAmount instanceof Prisma.Decimal ? patch.netAmount : row.netAmount,
        };
        counters.transactions++;
        userIds.add(row.userId);
        const customer = customerFromTransaction(patched);
        if (customer) {
          const key = `${customer.userId}:${customer.document}`;
          const previous = customers.get(key);
          if (previous && (previous.email !== customer.email || previous.name !== customer.name))
            customerConflicts.add(key);
          customers.set(key, customer);
          counters.customersEligible++;
        } else if (patched.customerDocument || patched.customerName || patched.customerEmail) counters.customersIncomplete++;
        const owner = ownerFromDescription(patched.description ?? null);
        if (owner) {
          const key = `${owner.platform}:${owner.document}`;
          const previous = owners.get(key);
          owners.set(key, { ...owner, name: owner.name ?? previous?.name ?? null });
          counters.ownersEligible++;
          if (row.status === 'COMPLETED') {
            const revenue = ownerRevenue.get(key) ?? { net: zero, missingNet: 0, completed: 0 };
            revenue.completed++;
            if (patched.netAmount == null) revenue.missingNet++;
            else revenue.net = revenue.net.add(patched.netAmount as Prisma.Decimal);
            ownerRevenue.set(key, revenue);
          }
        } else if (/\[(?:CPF|CNPJ)_DONO:/i.test(patched.description ?? '')) counters.ownerRowsIncomplete++;
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
      summary: { ...counters, provenUsers: proven.size, newUsers: newUsers.length,
        skippedUsers, uniqueCustomers: customers.size, newCustomers: customerCreates.length,
        uniqueOwners: ownerPlan.length, newOwners: ownerPlan.filter(o => !o.existingId).length,
        newExternalWallets: ownerPlan.filter(o => o.needsWallet && !o.purged).length },
      financial, reviewedBalances: balances }, null, 2));

    if (!apply) return;
    const createdEmails: string[] = [];
    const passwordHash = newUsers.length ? await hash(process.env.RECOVERY_INITIAL_PASSWORD!, 12) : null;
    for (const candidate of newUsers) {
      try {
        await prisma.user.create({ data: { id: candidate.id, name: candidate.name,
          email: candidate.email, password: passwordHash!, cpf: candidate.cpf, cnpj: candidate.cnpj,
          domUserId: candidate.domUserId, role: candidate.role, isActive: candidate.isActive,
          isCompany: candidate.isCompany, clientStatus: candidate.clientStatus,
          clientApprovedAt: null } });
        counters.usersCreated++;
        createdEmails.push(candidate.email);
        console.log(JSON.stringify({ createdEmail: candidate.email }));
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          skippedUsers.push({ id: candidate.id, reason: 'conflito de identidade durante criação' });
          continue;
        }
        throw error;
      }
    }
    for (const [id, patch] of domPatches) {
      const current = await prisma.transaction.findUnique({ where: { id }, select: {
        netAmount: true, customerName: true, customerEmail: true, customerDocument: true,
        customerPhone: true, description: true } });
      if (!current) continue;
      const data = Object.fromEntries(Object.entries(patch).filter(([key]) =>
        current[key as keyof typeof current] == null));
      if (Object.keys(data).length) await prisma.transaction.update({ where: { id }, data });
    }
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
    console.log(JSON.stringify({ applied: counters, createdEmails, skippedUsers }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('/recover-from-transactions.ts')) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Falha inesperada na recuperação.');
  process.exitCode = 1;
});
