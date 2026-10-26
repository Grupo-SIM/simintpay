import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { allocateNet, productTables, validateAgreement, type Product, type Snapshot } from './coproduction';

type Saved = { mode?: 'OWN' | 'INHERIT'; version: number; participants: { userId: string; percentageBps: number }[] };

@Injectable()
export class CoproductionService {
  constructor(private readonly prisma: PrismaService) {}

  accounts(actorId: string, search = '', pageValue = '1') {
    if (typeof search !== 'string' || search.length > 100 || typeof pageValue !== 'string' || !/^[1-9]\d*$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) > 1000000) throw new BadRequestException('Pesquisa ou página inválida');
    const term = search.trim().replace(/[\\%_]/g, '\\$&'), page = Number(pageValue), pageSize = 20;
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, clientStatus: true, isActive: true, isPurged: true } });
      if (!actor?.isActive || actor.isPurged || (actor.role !== 'ADMIN' && actor.clientStatus !== 'APPROVED')) throw new ForbiddenException('Pesquisa exige conta aprovada');
      const where: Prisma.UserWhereInput = { id: { not: actorId }, role: 'USER', clientStatus: 'APPROVED', isActive: true, isPurged: false,
        OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] };
      const [data, total] = await Promise.all([
        tx.user.findMany({ where, select: { id: true, name: true, email: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: pageSize, skip: (page - 1) * pageSize }),
        tx.user.count({ where }),
      ]);
      return { data, total, page, pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async authorize(tx: Prisma.TransactionClient, actorId: string, product: string, id: string) {
    if (!Object.hasOwn(productTables, product)) throw new BadRequestException('Tipo de produto inválido');
    const table = Prisma.raw('"' + productTables[product as Product] + '"');
    const ownerColumn = Prisma.raw(product === 'plataformas' ? '"ownerUserId"' : '"userId"');
    const rows = await tx.$queryRaw<{ userId: string }[]>(Prisma.sql`SELECT ${ownerColumn} AS "userId" FROM ${table} WHERE id = ${id} FOR SHARE`);
    if (!rows.length) throw new NotFoundException('Produto não encontrado');
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor?.isActive || actor.isPurged || (actor.role !== 'ADMIN' && (actor.clientStatus !== 'APPROVED' || rows[0].userId !== actorId))) throw new ForbiddenException('Co-produção restrita ao proprietário aprovado ou administrador');
    return rows[0].userId;
  }

  private async read(tx: Prisma.TransactionClient, product: string, id: string) {
    const rows = await tx.$queryRaw<Saved[]>`SELECT version, participants, mode FROM "CoproductionAgreement" WHERE product = ${product} AND "productId" = ${id}`;
    return rows[0] ?? { version: 0, participants: [] };
  }

  private async present(tx: Prisma.TransactionClient, saved: Saved, effective?: Snapshot | null) {
    const users = await tx.user.findMany({ where: { id: { in: saved.participants.map(p => p.userId) } }, select: { id: true, name: true, email: true } });
    const effectiveUsers = effective ? await tx.user.findMany({ where: { id: { in: effective.participants.map(p => p.userId) } }, select: { id: true, name: true, email: true } }) : [];
    return { data: { basis: 'NET' as const, mode: saved.mode ?? (saved.version ? 'OWN' : 'INHERIT'), version: saved.version, effective: effective ? { source: effective.source ?? null, participants: effective.participants.map(p => { const u = effectiveUsers.find(u => u.id === p.userId); if (!u) throw new ConflictException('Conta beneficiária indisponível'); return { email: u.email, name: u.name, percentageBps: p.percentageBps }; }) } : null, participants: saved.participants.map(p => {
      const user = users.find(u => u.id === p.userId);
      if (!user) throw new ConflictException('Conta beneficiária indisponível');
      return { email: user.email, name: user.name, percentageBps: p.percentageBps };
    }) } };
  }

  get(actorId: string, product: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const ownerId = await this.authorize(tx, actorId, product, id);
      const saved = await this.read(tx, product, id);
      return this.present(tx, { ...saved, ...(product === 'plataformas' ? { mode: 'OWN' as const } : {}) }, await captureCoproduction(tx, product as Product, id, ownerId));
    });
  }

  save(actorId: string, product: string, id: string, body: unknown) {
    const input = validateAgreement(body);
    return this.prisma.$transaction(async tx => {
      const ownerId = await this.authorize(tx, actorId, product, id);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`coproduction:${product}:${id}`}, 0))::text`;
      const previous = await this.read(tx, product, id);
      if (previous.version !== input.version) throw new ConflictException('Configuração alterada por outra sessão. Recarregue antes de salvar.');
      if (product === 'plataformas' && input.mode === 'INHERIT') throw new BadRequestException('Plataforma não herda co-produção');
      if (product === 'plataformas' && input.participants.length) {
        const companies = await tx.platformApiCredential.count({ where: { platformId: id, source: 'delivery', isActive: true } });
        const registrations = await tx.deliveryPlatformRegistration.count({ where: { platformId: id } });
        if (Math.max(companies, registrations) > 1) throw new ConflictException('Plataforma Delivery compartilhada exige regularização antes da co-produção');
      }
      const participants = await resolveParticipants(tx, ownerId, input);
      const version = previous.version + 1;
      await persistAgreement(tx, product, id, version, participants, actorId, input.mode ?? 'OWN');
      return this.present(tx, { version, participants, mode: input.mode ?? 'OWN' }, await captureCoproduction(tx, product as Product, id, ownerId));
    });
  }

  receipts(actorId: string, pageValue = '1') {
    if (!/^[1-9]\d*$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) > 1000000) throw new BadRequestException('Página inválida');
    const page = Number(pageValue), offset = (page - 1) * 10;
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId } });
      if (!actor?.isActive || actor.isPurged || actor.role !== 'USER' || actor.clientStatus !== 'APPROVED') throw new ForbiddenException('Recebimentos exclusivos de clientes aprovados');
      const predicate = Prisma.sql`a."userId" = ${actorId} AND t."userId" <> ${actorId}`;
      const [totals, rows] = await Promise.all([
        tx.$queryRaw<{ count: bigint; available: Prisma.Decimal; locked: Prisma.Decimal; reversed: Prisma.Decimal }[]>(Prisma.sql`SELECT count(*) AS count,
          coalesce(sum(a.amount) FILTER (WHERE a.state = 'AVAILABLE'), 0) AS available,
          coalesce(sum(a.amount) FILTER (WHERE a.state = 'LOCKED'), 0) AS locked,
          coalesce(sum(a.amount) FILTER (WHERE a.state = 'REVERSED'), 0) AS reversed
          FROM "CoproductionAllocation" a JOIN "Transaction" t ON t.id = a."transactionId" WHERE ${predicate}`),
        tx.$queryRaw<{ transactionId: string; amount: Prisma.Decimal; state: string; createdAt: Date; product: string }[]>(Prisma.sql`SELECT a."transactionId", a.amount, a.state, a."createdAt", t."financialSnapshot" #>> '{coproduction,product}' AS product
          FROM "CoproductionAllocation" a JOIN "Transaction" t ON t.id = a."transactionId" WHERE ${predicate}
          ORDER BY a."createdAt" DESC, a."transactionId" ASC LIMIT 10 OFFSET ${offset}`),
      ]);
      const cents = (amount: Prisma.Decimal) => new Prisma.Decimal(amount).mul(100).toNumber();
      return { data: rows.map(({ amount, ...row }) => ({ ...row, amountCents: cents(amount) })),
        summary: { creditedCents: cents(totals[0].available), lockedCents: cents(totals[0].locked), reversedCents: cents(totals[0].reversed) }, total: Number(totals[0].count), page, pageSize: 10 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

/** Capture before contacting the gateway. Public responses must never include this object. */
export async function captureCoproduction(prisma: Pick<Prisma.TransactionClient, '$queryRaw'>, product: Product, productId: string, ownerUserId: string, platformTag?: string): Promise<Snapshot | null> {
  const rows = await prisma.$queryRaw<Saved[]>`SELECT version, participants, mode FROM "CoproductionAgreement" WHERE product = ${product} AND "productId" = ${productId}`;
  const saved = rows[0];
  if (saved && (saved.mode ?? 'OWN') === 'OWN') return makeSnapshot(saved, product, productId, ownerUserId, product === 'plataformas' ? productId : undefined);
  if (product === 'plataformas') return null;
  if (!platformTag) {
    const table = Prisma.raw('"' + productTables[product] + '"');
    const tagColumn = Prisma.raw(product === 'planos-pix' ? 'p."tenantTag"' : product === 'links-assinatura' ? 'coalesce(p."platformTag", p.plataformas[1])' : 'p.plataformas[1]');
    const products = await prisma.$queryRaw<{ tag: string | null }[]>(Prisma.sql`SELECT coalesce(${tagColumn}, fallback.tag) AS tag FROM ${table} p JOIN "User" u ON u.id = p."userId" LEFT JOIN "Platform" fallback ON fallback.id = u."platformId" WHERE p.id = ${productId}`);
    platformTag = products[0]?.tag ?? undefined;
  }
  if (!platformTag || ['GLOBAL', 'SIMINTPAY'].includes(platformTag.toUpperCase())) return null;
  const platforms = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Platform" WHERE tag = ${platformTag.toUpperCase()} AND "isActive" = true`;
  if (!platforms.length) return null;
  const defaults = await prisma.$queryRaw<Saved[]>`SELECT version, participants, mode FROM "CoproductionAgreement" WHERE product = 'plataformas' AND "productId" = ${platforms[0].id}`;
  return defaults[0] ? makeSnapshot(defaults[0], product, productId, ownerUserId, platforms[0].id) : null;
}
function makeSnapshot(saved: Saved, product: Product, productId: string, ownerUserId: string, platformId?: string): Snapshot | null {
  // A financial beneficiary's own percentage is part of its residual, never a second credit.
  const participants = saved.participants.filter(p => p.userId !== ownerUserId);
  return participants.length ? { basis: 'NET', version: saved.version, product, productId, ownerUserId, participants,
    ...(platformId ? { source: { platformId, version: saved.version } } : {}) } : null;
}

export function withCoproduction(financial: Prisma.InputJsonValue | undefined, snapshot: Snapshot | null, legacy?: { totalAmount: number; netAmount: number; totalFeeAmount: number; domFeeAmount: number; platformProfit: number; policyTag: string }): Prisma.InputJsonValue | undefined {
  if (!snapshot) return financial;
  const netCents = financial && typeof financial === 'object' && !Array.isArray(financial) && 'netCents' in financial ? financial.netCents : undefined;
  if (typeof netCents === 'number') allocateNet(snapshot, new Prisma.Decimal(netCents).div(100));
  else if (legacy) allocateNet(snapshot, new Prisma.Decimal(legacy.netAmount));
  return { ...(financial as Prisma.InputJsonObject ?? {}), coproduction: snapshot as unknown as Prisma.InputJsonValue, ...(!financial && legacy ? { coproductionLegacy: legacy } : {}) };
}


async function resolveParticipants(tx: Prisma.TransactionClient, ownerId: string, input: ReturnType<typeof validateAgreement>) {
  const participants: Saved['participants'] = [];
  for (const p of input.participants) {
    const users = await tx.user.findMany({ where: { email: { equals: p.email, mode: 'insensitive' } }, select: { id: true, isActive: true, isPurged: true, clientStatus: true, role: true } });
    const user = users[0];
    if (users.length !== 1 || !user.isActive || user.isPurged || user.clientStatus !== 'APPROVED' || user.role !== 'USER') throw new BadRequestException('Coprodutor deve ter uma conta cliente ativa e aprovada');
    if (user.id === ownerId || participants.some(p => p.userId === user.id)) throw new BadRequestException('Proprietário ou coprodutor duplicado');
    participants.push({ userId: user.id, percentageBps: p.percentageBps });
  }
  return participants;
}

async function persistAgreement(tx: Prisma.TransactionClient, product: string, id: string, version: number, participants: Saved['participants'], actorId: string, mode: 'OWN' | 'INHERIT' = 'OWN') {
  await tx.$executeRaw`INSERT INTO "CoproductionAgreement" (product, "productId", version, participants, "actorId", mode)
    VALUES (${product}, ${id}, ${version}, ${JSON.stringify(participants)}::jsonb, ${actorId}, ${mode})
    ON CONFLICT (product, "productId") DO UPDATE SET version = EXCLUDED.version, participants = EXCLUDED.participants, "actorId" = EXCLUDED."actorId", mode = EXCLUDED.mode, "updatedAt" = now()`;
  await tx.$executeRaw`INSERT INTO "CoproductionRevision" (product, "productId", version, participants, "actorId", mode) VALUES (${product}, ${id}, ${version}, ${JSON.stringify(participants)}::jsonb, ${actorId}, ${mode})`;
}

/** The local product and its initial agreement commit together or neither exists. */
export function createWithCoproduction<T extends { id: string }>(prisma: PrismaService, product: Product, ownerId: string, body: unknown, create: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (body === undefined) return create(prisma);
  const input = validateAgreement(body);
  if (input.version !== 0) throw new BadRequestException('Co-produção inicial deve usar versão zero');
  return prisma.$transaction(async tx => {
    const participants = await resolveParticipants(tx, ownerId, input);
    const saved = await create(tx);
    await persistAgreement(tx, product, saved.id, 1, participants, ownerId, input.mode ?? 'OWN');
    return saved;
  });
}
