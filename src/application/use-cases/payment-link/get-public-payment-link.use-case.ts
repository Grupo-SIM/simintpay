import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import { calculatePaymentLinkFees } from './payment-link-fees.helper';

type InstallmentOption = {
  parcelas: number;
  taxaJurosPlatforma: number;
  valorJurosPlatforma: number;
  taxaDom: number;
  valorTaxaDom: number;
  valorTotal: number;
  valorParcela: number;
  // para exibição no checkout
  temJuros: boolean;
};

@Injectable()
export class GetPublicPaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
  ) {}

  async execute(id: string): Promise<{
    id: string;
    titulo: string;
    descricao: string | null;
    valor: number;
    parcelasMax: number;
    aceitaCartao: boolean;
    aceitaPix: boolean;
    ativo: boolean;
    isStandalone: boolean;
    dataExpiracao: string | null;
    opcoesParcelas: InstallmentOption[];
    valorPix: number;
  }> {
    const link = await this.links.findById(id);
    const isExpired =
      Boolean((link as any)?.expiresAt) &&
      new Date((link as any).expiresAt).getTime() <= Date.now();
    if (!link || !link.isActive || isExpired) {
      throw new NotFoundException('Link de pagamento não encontrado ou inativo');
    }

    const maxInstallments = link.maxInstallments;
    const opcoesParcelas: InstallmentOption[] = [];

    for (let i = 1; i <= maxInstallments; i++) {
      const f = calculatePaymentLinkFees(link, i);
      opcoesParcelas.push({
        parcelas: i,
        taxaJurosPlatforma: f.platformFeeRate,
        valorJurosPlatforma: f.interestAmount,
        taxaDom: f.domFeeRate * 100,
        valorTaxaDom: f.domFeeAmount,
        valorTotal: f.totalAmount,
        valorParcela: f.installmentAmount,
        temJuros: f.platformFeeRate > 0,
      });
    }

    // PIX é sempre 1 parcela com juros conforme isStandalone
    const pixCalc = calculatePaymentLinkFees(link, 1);

    return {
      id: link.id,
      titulo: link.title,
      descricao: link.description ?? null,
      valor: Number(link.amount),
      parcelasMax: maxInstallments,
      aceitaCartao: (link as any).aceitaCartao ?? true,
      aceitaPix: (link as any).aceitaPix ?? true,
      ativo: link.isActive,
      isStandalone: (link as any).isStandalone ?? true,
      dataExpiracao: (link as any).expiresAt ? (link as any).expiresAt.toISOString() : null,
      opcoesParcelas,
      valorPix: pixCalc.totalAmount,
    };
  }
}
