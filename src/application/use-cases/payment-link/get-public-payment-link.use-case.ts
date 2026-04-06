import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { calculatePaymentLinkFees, calculateDebitFees } from './payment-link-fees.helper';
import { MODULE_REGISTRY } from '../../../modules/module.registry';

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

/**
 * Tenta extrair a platformTag a partir da descrição do link.
 * Suporta dois formatos:
 *   1. Tag estruturada: [CPF:...|REVALIDA]
 *   2. Texto livre: qualquer palavra que bata com um slug registrado (ex: "Acesso Revalida Class")
 */
function resolvePlatformTagFromDescription(description: string | null | undefined): string | null {
  const text = description ?? '';

  // Formato estruturado legado: [CPF:xxx|REVALIDA]
  const tagMatch = text.match(/\[CPF:[^\]|]*\|([^\]]+)\]/);
  if (tagMatch) return tagMatch[1].toUpperCase();

  // Texto livre: procura qualquer slug conhecido (case-insensitive)
  const slugs = Object.keys(MODULE_REGISTRY);
  const lower = text.toLowerCase();
  for (const slug of slugs) {
    if (lower.includes(slug.toLowerCase())) {
      return slug.toUpperCase();
    }
  }

  return null;
}

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
    opcoesParcelas: InstallmentOption[];
    valorPix: number;
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

    // 1º tenta extrair da descrição (formato legado ou texto livre)
    // 2º fallback: módulo do dono do link
    // 3º fallback final: GLOBAL
    const tagFromDescription = resolvePlatformTagFromDescription(link.description);
    let platformTag: string;

    if (tagFromDescription) {
      platformTag = tagFromDescription;
    } else {
      const owner = await this.users.findById(link.userId);
      platformTag = owner?.tenantModule?.slug?.toUpperCase() ?? 'GLOBAL';
    }

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

    const pixCalc = calculatePaymentLinkFees(link, 1, platformTag);
    const debitCalc = calculateDebitFees(link);

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
      opcoesParcelas,
      valorPix: pixCalc.totalAmount,
      debitFeePercent: debitCalc.platformFeePercent,
      debitFeeFixed: debitCalc.platformFeeFixed,
      debitTaxaDomPercent: debitCalc.domFeePercent,
      debitTaxaDomFixed: debitCalc.domFeeFixed,
      debitTotalFee: debitCalc.totalFeeAmount,
      debitNetAmount: debitCalc.netAmount,
    };
  }
}
