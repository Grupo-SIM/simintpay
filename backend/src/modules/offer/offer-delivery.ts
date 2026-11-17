import type { Logger } from '@nestjs/common';
import type { EmailService } from '../../infrastructure/email/email.service';
import { DEFAULT_ACCESS_EMAIL_BODY } from '../../infrastructure/email/access-email-template';
import type { StorageService } from '../../infrastructure/storage/storage.service';

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
