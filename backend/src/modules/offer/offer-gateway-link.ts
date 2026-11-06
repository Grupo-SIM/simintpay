import type { Offer } from '@prisma/client';
import type { DomPaymentLinkInput } from '../../core/services/payment-gateway.interface';

export const DEFAULT_BOLETO_DUE_DAYS = 3;

/**
 * Dias até o vencimento do boleto de uma oferta (`metadata.boletoDueDays`, inteiro 0-90;
 * 0 = sem vencimento configurado). Ausente ou inválido cai no padrão do boleto legado (3).
 * É o `vencimentoDias` legado: vira `expireDays` do `chargeBoletoForLink` e `boletoExpireDay`
 * do link.
 */
export function boletoDueDaysOf(
  metadata: Offer['metadata'] | Record<string, unknown> | null | undefined,
): number {
  const raw =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).boletoDueDays
      : undefined;
  return typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= 0 &&
    raw <= 90
    ? raw
    : DEFAULT_BOLETO_DUE_DAYS;
}

/**
 * Configuração do link de pagamento no adquirente, derivada dos meios aceitos pela oferta. Um
 * único link por oferta (ExternalRef `PAYMENT_LINK`): a configuração é função da oferta, então
 * o mesmo link serve a todos os meios. Boleto liga `aceitaBoleto` com o vencimento da oferta;
 * uma oferta só de boleto espelha o `CreateBoletoUseCase` (boleto + PIX à vista, sem cartão).
 * A cobrança do boleto em si vai direto a `/transactions` e não referencia o link.
 */
export function offerGatewayLinkInput(
  offer: Pick<
    Offer,
    | 'name'
    | 'description'
    | 'amountCents'
    | 'maxInstallments'
    | 'acceptedMethods'
    | 'metadata'
  >,
): DomPaymentLinkInput {
  const methods = offer.acceptedMethods;
  const boleto = methods.includes('BOLETO');
  const card = methods.some((m) => m === 'CREDIT_CARD' || m === 'DEBIT_CARD');
  const boletoOnly = boleto && methods.length === 1;
  return {
    title: offer.name,
    description: offer.description,
    amount: offer.amountCents / 100,
    maxInstallments: offer.maxInstallments,
    interestRateInstallment: 0,
    aceitaCartao: card,
    aceitaPix: methods.includes('PIX') || boletoOnly,
    ...(boleto
      ? {
          aceitaBoleto: true,
          boletoExpireDay: boletoDueDaysOf(offer.metadata),
        }
      : {}),
  };
}
