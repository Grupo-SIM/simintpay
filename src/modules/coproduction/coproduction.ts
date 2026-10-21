import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const productTables = {
  'links-pagamento': 'PaymentLink', 'links-assinatura': 'SubscriptionLink',
  boletos: 'Boleto', planos: 'Plan', 'planos-pix': 'PixCreditPlan',
} as const;
export type Product = keyof typeof productTables;
export type Participant = { email: string; percentageBps: number };
export type Agreement = { basis: 'NET'; version: number; participants: Participant[] };
export type Snapshot = { basis: 'NET'; version: number; product: Product; productId: string; ownerUserId: string; participants: { userId: string; percentageBps: number }[] };

export function validateAgreement(input: unknown): Agreement {
  if (!input || typeof input !== 'object') throw new BadRequestException('Configuração inválida');
  const row = input as Agreement;
  if (row.basis !== 'NET' || !Number.isSafeInteger(row.version) || row.version < 0 || !Array.isArray(row.participants) || row.participants.length > 100) throw new BadRequestException('Configuração inválida');
  const seen = new Set<string>();
  const participants = row.participants.map(p => {
    if (!p || typeof p.email !== 'string' || !Number.isInteger(p.percentageBps) || p.percentageBps < 1 || p.percentageBps > 10000) throw new BadRequestException('Participação inválida');
    const email = p.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) throw new BadRequestException('E-mail inválido ou duplicado');
    seen.add(email);
    return { email, percentageBps: p.percentageBps };
  });
  if (participants.reduce((total, p) => total + p.percentageBps, 0) > 10000) throw new BadRequestException('A soma das participações não pode ultrapassar 100%');
  return { basis: 'NET', version: row.version, participants };
}

/** Floor each beneficiary's share; the owner receives every residual cent. */
export function allocateNet(snapshot: Snapshot, amount: Prisma.Decimal) {
  const cents = amount.mul(100);
  if (!cents.isInteger() || cents.isNegative() || !cents.isFinite()) throw new BadRequestException('Líquido inválido para co-produção');
  const rows = snapshot.participants.map(p => ({ userId: p.userId, amount: cents.mul(p.percentageBps).div(10000).floor().div(100) }));
  const remaining = rows.reduce((net, row) => net.sub(row.amount), amount);
  return [{ userId: snapshot.ownerUserId, amount: remaining }, ...rows].sort((a, b) => a.userId.localeCompare(b.userId));
}

export function snapshotFrom(value: Prisma.JsonValue | null | undefined): Snapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('coproduction' in value)) return null;
  const s = value.coproduction as unknown as Snapshot;
  if (!s || s.basis !== 'NET' || !s.ownerUserId || !Array.isArray(s.participants)) throw new BadRequestException('Snapshot de co-produção inválido');
  const ids = new Set([s.ownerUserId]);
  let total = 0;
  for (const p of s.participants) {
    if (!p.userId || ids.has(p.userId) || !Number.isInteger(p.percentageBps) || p.percentageBps < 1 || p.percentageBps > 10000) throw new BadRequestException('Snapshot de co-produção inválido');
    ids.add(p.userId); total += p.percentageBps;
  }
  if (total > 10000) throw new BadRequestException('Snapshot de co-produção inválido');
  return s;
}
