import type { PaymentLinkPreviewDraft } from './payment-link-preview';

export function previewLink(draft: PaymentLinkPreviewDraft) {
  return {
    id: 'preview',
    titulo: draft.title,
    descricao: draft.description,
    valor: draft.amount,
    parcelasMax: draft.maxInstallments,
    aceitaCartao: draft.methods.credit,
    aceitaDebito: draft.methods.debit,
    aceitaPix: draft.methods.pix,
    ativo: true,
    isStandalone: true,
    valorPix: draft.pixAmount,
    valorDebito: draft.debitAmount,
    opcoesParcelas: draft.installments.map((option) => ({
      parcelas: option.count,
      valorTotal: option.total,
      valorParcela: option.amount,
      temJuros: option.interest > 0,
      taxaJurosPlatforma: 0,
      valorJurosPlatforma: option.interest,
      taxaDom: 0,
      valorTaxaDom: 0,
    })),
  };
}
