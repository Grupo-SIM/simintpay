import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, type PaymentLinkOffer, type PaymentLinkOfferFile } from '@prisma/client';

export const OFFER_TYPES = ['ORDER_BUMP', 'UPSELL', 'DOWNSELL'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

/** Limites por link — evita checkout poluído e payloads abusivos. */
export const MAX_ORDER_BUMPS = 5;

type Db = Prisma.TransactionClient;

export type OfferView = {
  id: string;
  tipo: OfferType;
  chamada: string | null;
  titulo: string;
  descricao: string | null;
  imagemUrl: string | null;
  valor: number;
  valorOriginal: number | null;
  posicao: number;
  ativo: boolean;
};

export type OfferFileView = { id: string; fileName: string; fileUrl: string; fileSize: number; createdAt: Date };

/** Visão do painel: inclui o material de entrega (mensagem e PDFs). */
export type AdminOfferView = OfferView & { mensagemEmail: string | null; arquivos: OfferFileView[] };

type OfferWithFiles = PaymentLinkOffer & { files?: PaymentLinkOfferFile[] };

/** Visão pública (checkout): nunca expõe a mensagem de entrega nem os PDFs. */
export function toOfferView(o: PaymentLinkOffer): OfferView {
  return {
    id: o.id,
    tipo: o.type as OfferType,
    chamada: o.headline ?? null,
    titulo: o.title,
    descricao: o.description ?? null,
    imagemUrl: o.imageUrl ?? null,
    valor: Number(o.price),
    valorOriginal: o.originalPrice != null ? Number(o.originalPrice) : null,
    posicao: o.position,
    ativo: o.isActive,
  };
}

export function toAdminOfferView(o: OfferWithFiles): AdminOfferView {
  return {
    ...toOfferView(o),
    mensagemEmail: o.emailBody ?? null,
    arquivos: (o.files ?? []).map(f => ({ id: f.id, fileName: f.fileName, fileUrl: f.fileUrl, fileSize: f.fileSize, createdAt: f.createdAt })),
  };
}

export async function listLinkOffers(db: Db, paymentLinkId: string, activeOnly = false): Promise<OfferWithFiles[]> {
  return db.paymentLinkOffer.findMany({
    where: { paymentLinkId, deletedAt: null, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ type: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    include: { files: { orderBy: { createdAt: 'asc' } } },
  });
}

export type SaveOfferInput = {
  id?: string;
  tipo: OfferType;
  chamada?: string | null;
  titulo: string;
  descricao?: string | null;
  imagemUrl?: string | null;
  mensagemEmail?: string | null;
  valor: number;
  valorOriginal?: number | null;
  ativo?: boolean;
};

/**
 * Sincroniza as ofertas do link com a lista enviada pelo painel.
 * Ofertas ausentes da lista recebem `deletedAt` (remoção lógica) — nada é apagado fisicamente.
 */
export async function saveLinkOffers(db: Db, paymentLinkId: string, offers: SaveOfferInput[]): Promise<OfferWithFiles[]> {
  const bumps = offers.filter(o => o.tipo === 'ORDER_BUMP');
  if (bumps.length > MAX_ORDER_BUMPS) throw new BadRequestException(`Máximo de ${MAX_ORDER_BUMPS} order bumps por link`);
  if (offers.filter(o => o.tipo === 'UPSELL').length > 1) throw new BadRequestException('Apenas 1 upsell por link');
  if (offers.filter(o => o.tipo === 'DOWNSELL').length > 1) throw new BadRequestException('Apenas 1 downsell por link');
  if (offers.some(o => o.tipo === 'DOWNSELL') && !offers.some(o => o.tipo === 'UPSELL')) {
    throw new BadRequestException('Downsell exige um upsell configurado');
  }
  for (const o of offers) {
    if (!(o.valor > 0)) throw new BadRequestException(`Valor inválido na oferta "${o.titulo}"`);
    if (o.valorOriginal != null && o.valorOriginal > 0 && o.valorOriginal < o.valor) {
      throw new BadRequestException(`O valor "de" da oferta "${o.titulo}" deve ser maior que o valor final`);
    }
  }

  const existing = await listLinkOffers(db, paymentLinkId);
  const existingIds = new Set(existing.map(o => o.id));
  const keptIds = new Set<string>();
  const positions: Record<string, number> = {};

  for (const o of offers) {
    const position = positions[o.tipo] = (positions[o.tipo] ?? -1) + 1;
    const data = {
      type: o.tipo,
      headline: o.chamada?.trim() || null,
      title: o.titulo.trim(),
      description: o.descricao?.trim() || null,
      imageUrl: o.imagemUrl?.trim() || null,
      // undefined preserva a mensagem atual (clientes antigos não enviam o campo)
      ...(o.mensagemEmail !== undefined ? { emailBody: o.mensagemEmail?.trim() || null } : {}),
      price: new Prisma.Decimal(o.valor),
      originalPrice: o.valorOriginal != null && o.valorOriginal > 0 ? new Prisma.Decimal(o.valorOriginal) : null,
      position,
      isActive: o.ativo ?? true,
    };
    if (o.id && existingIds.has(o.id)) {
      await db.paymentLinkOffer.update({ where: { id: o.id }, data });
      keptIds.add(o.id);
    } else {
      const created = await db.paymentLinkOffer.create({ data: { ...data, paymentLinkId } });
      keptIds.add(created.id);
    }
  }

  const removed = existing.filter(o => !keptIds.has(o.id)).map(o => o.id);
  if (removed.length > 0) {
    await db.paymentLinkOffer.updateMany({ where: { id: { in: removed } }, data: { deletedAt: new Date(), isActive: false } });
  }
  return listLinkOffers(db, paymentLinkId);
}

/** Valida os order bumps escolhidos pelo comprador. IDs desconhecidos/inativos são rejeitados. */
export async function resolveOrderBumps(db: Db, paymentLinkId: string, ids: unknown): Promise<PaymentLinkOffer[]> {
  if (ids == null) return [];
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new BadRequestException('orderBumpIds inválido');
  const unique = [...new Set(ids as string[])];
  if (unique.length === 0) return [];
  if (unique.length > MAX_ORDER_BUMPS) throw new BadRequestException('Order bumps em excesso');
  const offers = await db.paymentLinkOffer.findMany({
    where: { id: { in: unique }, paymentLinkId, type: 'ORDER_BUMP', isActive: true, deletedAt: null },
    orderBy: { position: 'asc' },
  });
  if (offers.length !== unique.length) throw new BadRequestException('Order bump indisponível');
  return offers;
}

/**
 * Valida a compra de um upsell/downsell: a oferta precisa pertencer ao link e existir
 * um pedido principal aprovado deste link, do mesmo comprador, ainda sem esta oferta.
 */
export async function resolveFunnelOffer(
  db: Db,
  input: { paymentLinkId: string; offerId: string; parentPaymentId?: string; customerEmail: string },
): Promise<{ offer: PaymentLinkOffer; parentTransactionId: string }> {
  const offer = await db.paymentLinkOffer.findFirst({
    where: { id: input.offerId, paymentLinkId: input.paymentLinkId, type: { in: ['UPSELL', 'DOWNSELL'] }, isActive: true, deletedAt: null },
  });
  if (!offer) throw new NotFoundException('Oferta não encontrada ou inativa');
  if (!input.parentPaymentId) throw new BadRequestException('Pedido principal não informado');

  const parent = await db.transaction.findFirst({
    where: {
      paymentLinkId: input.paymentLinkId,
      OR: [{ domPaymentId: input.parentPaymentId }, { id: input.parentPaymentId }],
    },
    select: { id: true, status: true, customerEmail: true },
  });
  if (!parent || parent.status !== 'COMPLETED') throw new BadRequestException('Pedido principal não aprovado');
  if ((parent.customerEmail ?? '').trim().toLowerCase() !== input.customerEmail.trim().toLowerCase()) {
    throw new BadRequestException('Pedido principal pertence a outro comprador');
  }

  const funnelSales = await db.paymentLinkOfferSale.findMany({
    where: { parentTransactionId: parent.id, type: { in: ['UPSELL', 'DOWNSELL'] } },
    select: { transactionId: true },
  });
  if (funnelSales.length > 0) {
    const paid = await db.transaction.count({
      where: { id: { in: funnelSales.map(s => s.transactionId) }, status: 'COMPLETED' },
    });
    if (paid > 0) throw new BadRequestException('Oferta pós-compra já adquirida neste pedido');
  }
  return { offer, parentTransactionId: parent.id };
}

export async function recordOfferSales(
  db: Db,
  input: { paymentLinkId: string; transactionId: string; parentTransactionId?: string | null; offers: PaymentLinkOffer[] },
): Promise<void> {
  if (input.offers.length === 0) return;
  await db.paymentLinkOfferSale.createMany({
    data: input.offers.map(o => ({
      offerId: o.id,
      paymentLinkId: input.paymentLinkId,
      transactionId: input.transactionId,
      parentTransactionId: input.parentTransactionId ?? null,
      type: o.type,
      title: o.title,
      price: o.price,
    })),
  });
}

export function sumOffers(offers: PaymentLinkOffer[]): number {
  return Math.round(offers.reduce((acc, o) => acc + Number(o.price) * 100, 0)) / 100;
}

/** Texto curto anexado à descrição da transação, ex: " + Ebook X + Ebook Y". */
export function offersDescriptionSuffix(offers: PaymentLinkOffer[]): string {
  return offers.length ? ` + ${offers.map(o => o.title).join(' + ')}` : '';
}
