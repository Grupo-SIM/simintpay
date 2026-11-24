import { getTokenCard } from '@/components/sdk';
import { fetchDomPublicKey } from '@/lib/dom-public-key';

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
    await fetchDomPublicKey(),
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
