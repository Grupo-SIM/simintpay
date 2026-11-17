import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { findOfferByAlias } from '../offer-access/find-offer-by-alias';

// Legacy ids are uuids; links created by platform routes use a sha256 hex id.
const UUID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})$/i;

type OfferReader = Pick<PrismaService, 'offer'> &
  Partial<Pick<PrismaService, 'offerCodeAlias'>>;

/**
 * Resolve uma oferta pelo código público e, se não houver, pelo id (somente
 * entradas no formato uuid). O checkout reescreve os parâmetros legados
 * (?simLinkCode=<PaymentLink.id>, ?simBoletoCode=<Boleto.id>) para
 * ?ofertaCode=<mesmo valor>, e a migração cria a oferta com o id legado.
 */
export async function findOfferByCodeOrId(prisma: OfferReader, code: string) {
  const byCode = await prisma.offer.findUnique({ where: { code } });
  if (byCode) return byCode;
  if (UUID_RE.test(code)) {
    const byId = await prisma.offer.findUnique({ where: { id: code } });
    if (byId) return byId;
  }
  // Último passo: alias ativo (ex.: `PX-ABC123` do antigo plano PIX).
  return prisma.offerCodeAlias
    ? findOfferByAlias({ offerCodeAlias: prisma.offerCodeAlias }, code)
    : null;
}
