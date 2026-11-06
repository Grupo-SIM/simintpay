import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OfferReader = Pick<PrismaService, 'offer'>;

/**
 * Resolve uma oferta pelo código público e, se não houver, pelo id (somente
 * entradas no formato uuid). O checkout reescreve os parâmetros legados
 * (?simLinkCode=<PaymentLink.id>, ?simBoletoCode=<Boleto.id>) para
 * ?ofertaCode=<mesmo valor>, e a migração cria a oferta com o id legado.
 */
export async function findOfferByCodeOrId(prisma: OfferReader, code: string) {
  const byCode = await prisma.offer.findUnique({ where: { code } });
  if (byCode || !UUID_RE.test(code)) return byCode;
  return prisma.offer.findUnique({ where: { id: code } });
}
