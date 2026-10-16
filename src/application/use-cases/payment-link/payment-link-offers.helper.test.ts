import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { resolveFunnelOffer, resolveOrderBumps, saveLinkOffers, sumOffers } from './payment-link-offers.helper';

function offer(over: Record<string, unknown> = {}): any {
  return { id: 'o1', paymentLinkId: 'link', type: 'ORDER_BUMP', title: 'Ebook', price: new Prisma.Decimal(19.9), position: 0, isActive: true, deletedAt: null, ...over };
}

test('sumOffers soma em centavos sem erro de ponto flutuante', () => {
  expect(sumOffers([offer({ price: new Prisma.Decimal(19.99) }), offer({ price: new Prisma.Decimal(19.9) })])).toBe(39.89);
});

test('resolveOrderBumps rejeita id desconhecido e aceita lista vazia', async () => {
  const db: any = { paymentLinkOffer: { findMany: async () => [offer()] } };
  expect(await resolveOrderBumps(db, 'link', undefined)).toEqual([]);
  expect(await resolveOrderBumps(db, 'link', ['o1', 'o1'])).toHaveLength(1);
  await expect(resolveOrderBumps(db, 'link', ['o1', 'x'])).rejects.toThrow('Order bump indisponível');
});

test('saveLinkOffers remove logicamente (deletedAt) ofertas omitidas — nunca apaga', async () => {
  const calls: any[] = [];
  const db: any = { paymentLinkOffer: {
    findMany: async () => [offer({ id: 'old' })],
    create: async ({ data }: any) => ({ id: 'new', ...data }),
    update: async () => ({}),
    updateMany: async (args: any) => { calls.push(args); return { count: 1 }; },
    delete: async () => { throw new Error('delete proibido'); },
    deleteMany: async () => { throw new Error('delete proibido'); },
  } };
  await saveLinkOffers(db, 'link', [{ tipo: 'UPSELL', titulo: 'Mentoria', valor: 97 }]);
  expect(calls[0].where.id.in).toEqual(['old']);
  expect(calls[0].data.deletedAt).toBeInstanceOf(Date);
});

test('saveLinkOffers exige upsell para downsell', async () => {
  const db: any = { paymentLinkOffer: { findMany: async () => [] } };
  await expect(saveLinkOffers(db, 'link', [{ tipo: 'DOWNSELL', titulo: 'X', valor: 10 }])).rejects.toThrow('Downsell exige');
});

test('resolveFunnelOffer exige pedido principal aprovado do mesmo comprador', async () => {
  const mk = (parent: any, sales: any[] = [], paid = 0): any => ({
    paymentLinkOffer: { findFirst: async () => offer({ type: 'UPSELL' }) },
    transaction: { findFirst: async () => parent, count: async () => paid },
    paymentLinkOfferSale: { findMany: async () => sales },
  });
  const input = { paymentLinkId: 'link', offerId: 'o1', parentPaymentId: 'dom-1', customerEmail: 'A@x.com' };
  await expect(resolveFunnelOffer(mk({ id: 't', status: 'PENDING', customerEmail: 'a@x.com' }), input)).rejects.toThrow('não aprovado');
  await expect(resolveFunnelOffer(mk({ id: 't', status: 'COMPLETED', customerEmail: 'b@x.com' }), input)).rejects.toThrow('outro comprador');
  await expect(resolveFunnelOffer(mk({ id: 't', status: 'COMPLETED', customerEmail: 'a@x.com' }, [{ transactionId: 'u' }], 1), input)).rejects.toThrow('já adquirida');
  const ok = await resolveFunnelOffer(mk({ id: 't', status: 'COMPLETED', customerEmail: 'a@x.com' }), input);
  expect(ok.parentTransactionId).toBe('t');
});

test('imagem do storage privado é exibida pela rota pública; URL externa segue direta', async () => {
  const { toOfferView } = await import('./payment-link-offers.helper');
  const updatedAt = new Date(1_700_000_000_000);
  const stored = toOfferView(offer({ id: 'o9', imageUrl: 'https://gateway.storjshare.io/ebook/payment-link-offers/x.png', updatedAt }));
  expect(stored.imagemUrl).toBe('https://simpay-back.simintermediacoes.com/links-pagamento/public/ofertas/o9/imagem?v=1700000000000');
  expect(toOfferView(offer({ imageUrl: 'https://cdn.exemplo.com/a.png', updatedAt })).imagemUrl).toBe('https://cdn.exemplo.com/a.png');
});

test('salvar com a URL da rota pública mantém o arquivo original da imagem', async () => {
  let updated: any;
  const db: any = { paymentLinkOffer: {
    findMany: async () => [offer({ id: 'o1', type: 'UPSELL', imageUrl: 'https://gateway.storjshare.io/ebook/payment-link-offers/orig.png' })],
    update: async ({ data }: any) => { updated = data; return {}; },
    updateMany: async () => ({ count: 0 }),
  } };
  await saveLinkOffers(db, 'link', [{ id: 'o1', tipo: 'UPSELL', titulo: 'X', valor: 1, imagemUrl: 'https://simpay-back.simintermediacoes.com/links-pagamento/public/ofertas/o1/imagem?v=1' }]);
  expect(updated.imageUrl).toBe('https://gateway.storjshare.io/ebook/payment-link-offers/orig.png');
});
