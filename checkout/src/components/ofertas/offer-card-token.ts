import { getTokenCard } from '@/components/sdk';

/** Chave pública do gateway (tokenização de cartão). */
const GATEWAY_PUBLIC_KEY = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';

export type TypedCard = {
  holderName: string;
  holderDocument: string;
  number: string;
  cvv: string;
  month: string;
  year: string;
};

/** Tokeniza de novo o cartão já digitado (tokens são de uso único) para a cobrança filha, à vista. */
export async function tokenizeTypedCard(
  card: TypedCard,
): Promise<{ card?: Record<string, string | undefined>; error?: string }> {
  const number = card.number.replace(/\s/g, '');
  const tokenRes = await getTokenCard(
    GATEWAY_PUBLIC_KEY,
    {
      name: card.holderName,
      document: card.holderDocument,
      number,
      cvv: card.cvv,
      month: card.month,
      year: card.year,
    },
    1,
  );
  if (!tokenRes.token)
    return { error: tokenRes.msgError || 'Erro ao tokenizar cartão' };
  return {
    card: {
      token: tokenRes.token,
      brand: tokenRes.brand,
      bin: tokenRes.bin,
      exp_month: card.month,
      exp_year: card.year,
      cvv: card.cvv,
      holder_name: card.holderName,
      holder_document: card.holderDocument,
      number,
    },
  };
}
