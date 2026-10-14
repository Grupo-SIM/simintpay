import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { calculatePaymentLinkFees, calculateDebitFees } from './payment-link-fees.helper';

type InstallmentOption = {
  parcelas: number;
  taxaJurosPlatforma: number;
  valorJurosPlatforma: number;
  taxaDom: number;
  valorTaxaDom: number;
  valorTotal: number;
  valorParcela: number;
  temJuros: boolean;
};

@Injectable()
export class GetPublicPaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
  ) {}

  async execute(id: string): Promise<{
    id: string;
    titulo: string;
    descricao: string | null;
    valor: number;
    parcelasMax: number;
    aceitaCartao: boolean;
    aceitaDebito: boolean;
    aceitaPix: boolean;
    ativo: boolean;
    isStandalone: boolean;
    dataExpiracao: string | null;
    redirectUrl: string | null;
    opcoesParcelas: InstallmentOption[];
    valorPix: number;
    valorDebito: number;
    platformTag: string;
    debitFeePercent: number;
    debitFeeFixed: number;
    debitTaxaDomPercent: number;
    debitTaxaDomFixed: number;
    debitTotalFee: number;
    debitNetAmount: number;
  }> {
    const link = await this.links.findById(id);
    const isExpired =
      Boolean((link as any)?.expiresAt) &&
      new Date((link as any).expiresAt).getTime() <= Date.now();
    if (!link || !link.isActive || isExpired) {
      throw new NotFoundException('Link de pagamento não encontrado ou inativo');
    }

    // 1º plataforma explícita salva no link (campo plataformas[0])
    // 2º formato legado na descrição (compatibilidade)
    // 3º módulo do dono do link
    // 4º fallback final: GLOBAL
    const linkPlataformas = (link as any).plataformas as string[] | undefined;
    const owner = await this.users.findById(link.userId);
    const platformTag = linkPlataformas?.[0]?.toUpperCase() ?? owner?.platform?.tag?.toUpperCase() ?? 'GLOBAL';

    // Validate platform lifecycle without resolving another platform from user identity.
    platformGatewayToken(platformTag, 'public-global');
    const maxInstallments = link.maxInstallments;
    const opcoesParcelas: InstallmentOption[] = [];

    for (let i = 1; i <= maxInstallments; i++) {
      const f = calculatePaymentLinkFees(link, i, platformTag);
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

    const debitCalc = calculateDebitFees(link, platformTag);

    // Para PIX, o cliente paga o valor base sem acréscimo de taxa de crédito.
    // A taxa de processamento PIX (MDR_PIX) fica do lado do vendedor, igual ao débito.
    const valorPix = Number(link.amount);

    return {
      id: link.id,
      titulo: link.title,
      descricao: link.description ?? null,
      valor: Number(link.amount),
      parcelasMax: maxInstallments,
      aceitaCartao: (link as any).aceitaCartao ?? true,
      aceitaDebito: (link as any).aceitaDebito ?? true,
      aceitaPix: (link as any).aceitaPix ?? true,
      ativo: link.isActive,
      isStandalone: (link as any).isStandalone ?? true,
      dataExpiracao: (link as any).expiresAt ? (link as any).expiresAt.toISOString() : null,
      redirectUrl: (link as any).redirectUrl ?? null,
      opcoesParcelas,
      valorPix,
      valorDebito: Number(link.amount),
      platformTag,
      debitFeePercent: debitCalc.platformFeePercent,
      debitFeeFixed: debitCalc.platformFeeFixed,
      debitTaxaDomPercent: debitCalc.domFeePercent,
      debitTaxaDomFixed: debitCalc.domFeeFixed,
      debitTotalFee: debitCalc.totalFeeAmount,
      debitNetAmount: debitCalc.netAmount,
    };
  }
}
