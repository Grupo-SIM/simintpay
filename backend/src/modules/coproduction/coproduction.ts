import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const productTables = {
  'links-pagamento': 'PaymentLink',
  'links-assinatura': 'SubscriptionLink',
  boletos: 'Boleto',
  planos: 'Plan',
  'planos-pix': 'PixCreditPlan',
  plataformas: 'Platform',
  ofertas: 'Offer',
} as const;
/** Column holding the financial owner: Platform and Offer name it `ownerUserId`, legacy products `userId`. */
export function productOwnerColumn(product: Product): string {
  return product === 'plataformas' || product === 'ofertas'
    ? 'ownerUserId'
    : 'userId';
}
export type Product = keyof typeof productTables;
export type Participant = { email: string; percentageBps: number };
export type Agreement = {
  basis: 'NET';
  version: number;
  mode?: 'OWN' | 'INHERIT';
  participants: Participant[];
};
export type Snapshot = {
  basis: 'NET';
  version: number;
  product: Product;
  productId: string;
  ownerUserId: string;
  baseCents?: number;
  source?: { platformId: string; version: number };
  participants: { userId: string; percentageBps: number }[];
};

export function validateAgreement(input: unknown): Agreement {
  if (!input || typeof input !== 'object')
    throw new BadRequestException('Configuração inválida');
  const row = input as Agreement;
  if (row.mode !== undefined && !['OWN', 'INHERIT'].includes(row.mode))
    throw new BadRequestException('Modo de co-produção inválido');
  if (row.mode === 'INHERIT' && row.participants?.length)
    throw new BadRequestException('Herança não permite participantes próprios');
  if (
    row.basis !== 'NET' ||
    !Number.isSafeInteger(row.version) ||
    row.version < 0 ||
    !Array.isArray(row.participants) ||
    row.participants.length > 100
  )
    throw new BadRequestException('Configuração inválida');
  const seen = new Set<string>();
  const participants = row.participants.map((p) => {
    if (
      !p ||
      typeof p.email !== 'string' ||
      !Number.isInteger(p.percentageBps) ||
      p.percentageBps < 1 ||
      p.percentageBps > 10000
    )
      throw new BadRequestException('Participação inválida');
    const email = p.email.trim().toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      seen.has(email)
    )
      throw new BadRequestException('E-mail inválido ou duplicado');
    seen.add(email);
    return { email, percentageBps: p.percentageBps };
  });
  if (participants.reduce((total, p) => total + p.percentageBps, 0) > 10000)
    throw new BadRequestException(
      'A soma das participações não pode ultrapassar 100%',
    );
  return {
    basis: 'NET',
    version: row.version,
    ...(row.mode ? { mode: row.mode } : {}),
    participants,
  };
}

/** Floor each beneficiary's share; the owner receives every residual cent. */
export function allocateNet(snapshot: Snapshot, amount: Prisma.Decimal) {
  const cents = amount.mul(100);
  if (!cents.isInteger() || cents.isNegative() || !cents.isFinite())
    throw new BadRequestException('Líquido inválido para co-produção');
  const base = new Prisma.Decimal(snapshot.baseCents ?? cents);
  if (
    !base.isInteger() ||
    base.isNegative() ||
    !base.isFinite() ||
    base.gt(cents)
  )
    throw new BadRequestException('Base inválida para co-produção');
  const rows = snapshot.participants.map((p) => ({
    userId: p.userId,
    amount: base.mul(p.percentageBps).div(10000).floor().div(100),
  }));
  const remaining = rows.reduce((net, row) => net.sub(row.amount), amount);
  return [{ userId: snapshot.ownerUserId, amount: remaining }, ...rows].sort(
    (a, b) => a.userId.localeCompare(b.userId),
  );
}

export function snapshotFrom(
  value: Prisma.JsonValue | null | undefined,
): Snapshot | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('coproduction' in value)
  )
    return null;
  const s = value.coproduction as unknown as Snapshot;
  if (
    !s ||
    s.basis !== 'NET' ||
    !s.ownerUserId ||
    !Array.isArray(s.participants)
  )
    throw new BadRequestException('Snapshot de co-produção inválido');
  if (
    s.baseCents !== undefined &&
    (!Number.isSafeInteger(s.baseCents) || s.baseCents < 0)
  )
    throw new BadRequestException('Base de co-produção inválida');
  const ids = new Set([s.ownerUserId]);
  let total = 0;
  for (const p of s.participants) {
    if (
      !p.userId ||
      ids.has(p.userId) ||
      !Number.isInteger(p.percentageBps) ||
      p.percentageBps < 1 ||
      p.percentageBps > 10000
    )
      throw new BadRequestException('Snapshot de co-produção inválido');
    ids.add(p.userId);
    total += p.percentageBps;
  }
  if (total > 10000)
    throw new BadRequestException('Snapshot de co-produção inválido');
  return s;
}

/** Seller revenue excludes partners, without treating their shares as processing fees. */
export function coproductionOwnerNet(
  value: unknown,
  amount: Prisma.Decimal,
): Prisma.Decimal {
  const agreement = snapshotFrom(value as Prisma.JsonValue);
  return agreement
    ? allocateNet(agreement, amount).find(
        (row) => row.userId === agreement.ownerUserId,
      )!.amount
    : amount;
}
