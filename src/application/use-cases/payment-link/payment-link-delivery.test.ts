import { expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { purchasedItemsByTransaction, resolveLinkDelivery, sendLinkDelivery } from './payment-link-delivery';
import { toOfferView, toAdminOfferView } from './payment-link-offers.helper';

const link: any = {
  id: 'link', title: 'Curso', amount: new Prisma.Decimal(97), emailBody: 'Acesso ao curso: https://curso',
  redirectUrl: 'https://obrigado', files: [{ fileName: 'curso.pdf', fileUrl: 'https://s/curso.pdf' }],
};
const bump: any = { id: 'b1', emailBody: 'Ebook: https://ebook', files: [{ fileName: 'ebook.pdf', fileUrl: 'https://s/ebook.pdf' }] };
const upsell: any = { id: 'u1', emailBody: 'Mentoria: https://mentoria', files: [] };

function db(sales: any[], offers: any[]): any {
  return {
    paymentLinkOfferSale: { findMany: async ({ where }: any) => sales.filter(s => where.transactionId?.in ? where.transactionId.in.includes(s.transactionId) : s.transactionId === where.transactionId) },
    paymentLinkOffer: { findMany: async ({ where }: any) => offers.filter(o => where.id.in.includes(o.id)) },
  };
}

test('pedido sem ofertas entrega só o material do link', async () => {
  const d = await resolveLinkDelivery(db([], []), 'tx', link);
  expect(d).toMatchObject({ kind: 'MAIN', title: 'Curso', body: 'Acesso ao curso: https://curso', redirectUrl: 'https://obrigado' });
  expect(d.files).toHaveLength(1);
  expect(d.items).toEqual([{ tipo: 'PRINCIPAL', titulo: 'Curso', valor: 97 }]);
});

test('order bump marcado soma mensagem e PDFs ao e-mail do pedido', async () => {
  const sales = [{ transactionId: 'tx', offerId: 'b1', type: 'ORDER_BUMP', title: 'Ebook', price: new Prisma.Decimal(19.9) }];
  const d = await resolveLinkDelivery(db(sales, [bump]), 'tx', link);
  expect(d.kind).toBe('MAIN');
  expect(d.body).toContain('https://curso');
  expect(d.body).toContain('— Ebook —\nEbook: https://ebook');
  expect(d.files.map(f => f.fileName)).toEqual(['curso.pdf', 'ebook.pdf']);
  expect(d.items.map(i => i.tipo)).toEqual(['PRINCIPAL', 'ORDER_BUMP']);
});

test('upsell entrega só o material da oferta — nunca reenvia o produto principal', async () => {
  const sales = [{ transactionId: 'tx2', offerId: 'u1', type: 'UPSELL', title: 'Mentoria', price: new Prisma.Decimal(197), parentTransactionId: 'tx' }];
  const d = await resolveLinkDelivery(db(sales, [upsell]), 'tx2', link);
  expect(d).toMatchObject({ kind: 'OFFER', title: 'Mentoria', body: 'Mentoria: https://mentoria', redirectUrl: null });
  expect(d.files).toHaveLength(0);
  expect(d.items).toEqual([{ tipo: 'UPSELL', offerId: 'u1', titulo: 'Mentoria', valor: 197 }]);
});

test('upsell sem material não envia e-mail', async () => {
  const email: any = { sendEbookAccessEmail: mock(async () => {}), sendPaymentLinkFiles: mock(async () => {}), sendPaymentLinkConfirmation: mock(async () => {}) };
  const sent = await sendLinkDelivery({ email }, { email: 'a@x.com', name: 'A', transactionId: 't' },
    { kind: 'OFFER', title: 'X', body: null, redirectUrl: null, files: [], items: [] });
  expect(sent).toBe(false);
  expect(email.sendEbookAccessEmail).not.toHaveBeenCalled();
});

test('sendLinkDelivery preserva os formatos antigos do link (só PDFs / só redirect)', async () => {
  const email: any = { sendEbookAccessEmail: mock(async () => {}), sendPaymentLinkFiles: mock(async () => {}), sendPaymentLinkConfirmation: mock(async () => {}) };
  const storage: any = { getReceiptBufferByStoredUrl: async () => ({ buffer: Buffer.from('%PDF') }) };
  const to = { email: 'a@x.com', name: null, transactionId: 't' };
  await sendLinkDelivery({ email, storage }, to, { kind: 'MAIN', title: 'L', body: null, redirectUrl: null, files: [{ fileName: 'a.pdf', fileUrl: 'u' }], items: [] });
  await sendLinkDelivery({ email, storage }, to, { kind: 'MAIN', title: 'L', body: null, redirectUrl: 'https://r', files: [], items: [] });
  expect(email.sendPaymentLinkFiles).toHaveBeenCalledTimes(1);
  expect(email.sendPaymentLinkConfirmation).toHaveBeenCalledTimes(1);
  expect(email.sendEbookAccessEmail).not.toHaveBeenCalled();
});

test('itens por transação em lote (webhook das plataformas)', async () => {
  const sales = [
    { transactionId: 'a', offerId: 'b1', type: 'ORDER_BUMP', title: 'Ebook', price: new Prisma.Decimal(10) },
    { transactionId: 'b', offerId: 'u1', type: 'DOWNSELL', title: 'Mini', price: new Prisma.Decimal(5) },
  ];
  const map = await purchasedItemsByTransaction(db(sales, []), [
    { id: 'a', paymentLink: link }, { id: 'b', paymentLink: link }, { id: 'c', paymentLink: null },
  ]);
  expect(map.get('a')!.map(i => i.tipo)).toEqual(['PRINCIPAL', 'ORDER_BUMP']);
  expect(map.get('b')).toEqual([{ tipo: 'DOWNSELL', offerId: 'u1', titulo: 'Mini', valor: 5 }]);
  expect(map.has('c')).toBe(false);
});

test('checkout público nunca recebe a mensagem de entrega nem os PDFs', () => {
  const offer: any = { id: 'o', type: 'UPSELL', headline: null, title: 'T', description: null, imageUrl: null, emailBody: 'link secreto', price: new Prisma.Decimal(1), originalPrice: null, position: 0, isActive: true, files: [{ id: 'f', fileName: 'x.pdf', fileUrl: 'u', fileSize: 1, createdAt: new Date() }] };
  expect(JSON.stringify(toOfferView(offer))).not.toContain('link secreto');
  expect(toOfferView(offer)).not.toHaveProperty('arquivos');
  expect(toAdminOfferView(offer)).toMatchObject({ mensagemEmail: 'link secreto', arquivos: [{ id: 'f' }] });
});
