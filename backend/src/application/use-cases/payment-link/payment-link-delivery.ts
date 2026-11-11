import type { Logger } from '@nestjs/common';
import type { PaymentLink, PaymentLinkFile, Prisma } from '@prisma/client';
import type { EmailService } from '../../../infrastructure/email/email.service';
import { DEFAULT_ACCESS_EMAIL_BODY } from '../../../infrastructure/email/access-email-template';
import type { StorageService } from '../../../infrastructure/storage/storage.service';

type Db = Prisma.TransactionClient;

/** Item comprado numa transação de link — enviado aos webhooks para a plataforma saber o que liberar. */
export type PurchasedItem = {
  tipo: 'PRINCIPAL' | 'ORDER_BUMP' | 'UPSELL' | 'DOWNSELL';
  offerId?: string;
  titulo: string;
  valor: number;
};

/**
 * Material a entregar por e-mail para uma transação aprovada.
 * - MAIN: produto do link + order bumps marcados (um e-mail só).
 * - OFFER: apenas o upsell/downsell comprado — nunca reenvia o material do produto principal.
 */
export type LinkDelivery = {
  kind: 'MAIN' | 'OFFER';
  title: string;
  body: string | null;
  redirectUrl: string | null;
  files: { fileName: string; fileUrl: string }[];
  items: PurchasedItem[];
};

const DEFAULT_BODY = DEFAULT_ACCESS_EMAIL_BODY;

export async function resolveLinkDelivery(
  db: Db,
  transactionId: string,
  link: PaymentLink & {
    files: Pick<PaymentLinkFile, 'fileName' | 'fileUrl'>[];
  },
): Promise<LinkDelivery> {
  const sales = await db.paymentLinkOfferSale.findMany({
    where: { transactionId },
    orderBy: { createdAt: 'asc' },
  });
  // Ofertas removidas depois da venda continuam sendo entregues (o comprador pagou por elas).
  const offers = sales.length
    ? await db.paymentLinkOffer.findMany({
        where: { id: { in: sales.map((s) => s.offerId) } },
        include: { files: true },
      })
    : [];
  const byId = new Map(offers.map((o) => [o.id, o]));

  const funnel = sales.find(
    (s) => s.type === 'UPSELL' || s.type === 'DOWNSELL',
  );
  if (funnel) {
    const offer = byId.get(funnel.offerId);
    return {
      kind: 'OFFER',
      title: funnel.title,
      body: offer?.emailBody?.trim() || null,
      redirectUrl: null,
      files: offer?.files ?? [],
      items: [
        {
          tipo: funnel.type as PurchasedItem['tipo'],
          offerId: funnel.offerId,
          titulo: funnel.title,
          valor: Number(funnel.price),
        },
      ],
    };
  }

  const bumps = sales.filter((s) => s.type === 'ORDER_BUMP');
  const sections: string[] = [];
  if (link.emailBody?.trim()) sections.push(link.emailBody.trim());
  for (const s of bumps) {
    const body = byId.get(s.offerId)?.emailBody?.trim();
    if (body) sections.push(`— ${s.title} —\n${body}`);
  }
  return {
    kind: 'MAIN',
    title: bumps.length
      ? `${link.title} + ${bumps.map((b) => b.title).join(' + ')}`
      : link.title,
    body: sections.join('\n\n') || null,
    redirectUrl: link.redirectUrl?.trim() || null,
    files: [
      ...link.files,
      ...bumps.flatMap((s) => byId.get(s.offerId)?.files ?? []),
    ],
    items: [
      { tipo: 'PRINCIPAL', titulo: link.title, valor: Number(link.amount) },
      ...bumps.map((s) => ({
        tipo: 'ORDER_BUMP' as const,
        offerId: s.offerId,
        titulo: s.title,
        valor: Number(s.price),
      })),
    ],
  };
}

/** Itens comprados em várias transações de uma vez (uma consulta por lote). */
export async function purchasedItemsByTransaction(
  db: Db,
  txs: {
    id: string;
    paymentLink: Pick<PaymentLink, 'title' | 'amount'> | null;
  }[],
): Promise<Map<string, PurchasedItem[]>> {
  const result = new Map<string, PurchasedItem[]>();
  const linkTxs = txs.filter((t) => t.paymentLink);
  if (linkTxs.length === 0) return result;
  const sales = await db.paymentLinkOfferSale.findMany({
    where: { transactionId: { in: linkTxs.map((t) => t.id) } },
    orderBy: { createdAt: 'asc' },
  });
  for (const t of linkTxs) {
    const own = sales.filter((s) => s.transactionId === t.id);
    const funnel = own.find(
      (s) => s.type === 'UPSELL' || s.type === 'DOWNSELL',
    );
    const toItem = (s: (typeof own)[number]): PurchasedItem => ({
      tipo: s.type as PurchasedItem['tipo'],
      offerId: s.offerId,
      titulo: s.title,
      valor: Number(s.price),
    });
    result.set(
      t.id,
      funnel
        ? [toItem(funnel)]
        : [
            {
              tipo: 'PRINCIPAL',
              titulo: t.paymentLink!.title,
              valor: Number(t.paymentLink!.amount),
            },
            ...own.filter((s) => s.type === 'ORDER_BUMP').map(toItem),
          ],
    );
  }
  return result;
}

export async function loadDeliveryAttachments(
  storage: StorageService | undefined,
  files: LinkDelivery['files'],
) {
  if (!storage || files.length === 0) return [];
  return Promise.all(
    files.map(async (f) => ({
      filename: f.fileName.replace(/^[a-f0-9]{64}-/, ''),
      content: (await storage.getReceiptBufferByStoredUrl(f.fileUrl)).buffer,
    })),
  );
}

/**
 * Envia o e-mail de entrega. Mantém o comportamento original do link (mensagem personalizada,
 * só PDFs ou só redirect) e sempre manda e-mail próprio para upsell/downsell com material.
 */
export async function sendLinkDelivery(
  deps: { email: EmailService; storage?: StorageService; logger?: Logger },
  to: { email: string; name: string | null; transactionId: string },
  d: LinkDelivery,
): Promise<boolean> {
  if (!d.body && d.files.length === 0 && !d.redirectUrl) return false;
  const attachments = await loadDeliveryAttachments(deps.storage, d.files);
  const customerName = to.name ?? 'Cliente';

  if (d.body || d.kind === 'OFFER') {
    await deps.email.sendEbookAccessEmail({
      to: to.email,
      customerName,
      title: d.title,
      body: d.body ?? DEFAULT_BODY,
      redirectUrl: d.redirectUrl,
      attachments,
    });
  } else if (attachments.length > 0) {
    await deps.email.sendPaymentLinkFiles({
      to: to.email,
      customerName,
      linkTitle: d.title,
      attachments,
      redirectUrl: d.redirectUrl,
    });
  } else if (d.redirectUrl) {
    await deps.email.sendPaymentLinkConfirmation({
      to: to.email,
      customerName,
      linkTitle: d.title,
      redirectUrl: d.redirectUrl,
    });
  }
  deps.logger?.log(
    `[LinkDelivery] ${d.kind} entregue para ${to.email} (tx=${to.transactionId}, itens=${d.items.length})`,
  );
  return true;
}

export { DEFAULT_BODY as DEFAULT_DELIVERY_BODY };
