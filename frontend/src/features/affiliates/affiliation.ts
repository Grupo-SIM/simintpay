import type {
  Transacao,
  TransacaoAfiliacao,
} from '@/features/transacoes/types/transacoes.types';

const stateLabels: Record<string, string> = {
  AVAILABLE: 'Creditada',
  LOCKED: 'Pendente',
  REVERSED: 'Revertida',
};

/** Estado da comissão em português; valores desconhecidos aparecem como vieram. */
export const affiliationStateLabel = (state: string | null | undefined) =>
  state ? (stateLabels[state] ?? state) : 'Aguardando pagamento';

/** Afiliado sem coprodução na venda: enxerga só a própria comissão, sem comprador nem taxas. */
export const isAffiliateOnly = (
  row: Pick<Transacao, 'afiliacao' | 'coproducao'>,
) => row.afiliacao?.role === 'AFFILIATE' && !row.coproducao;

/** Comissão exibida na linha: a do afiliado (própria) ou a paga pelo dono. */
export function affiliationAmountCents(afiliacao: TransacaoAfiliacao) {
  return afiliacao.role === 'AFFILIATE'
    ? afiliacao.myAmountCents
    : (afiliacao.affiliateCommissionCents ?? null);
}
