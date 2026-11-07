import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../../../modules/financial-policy/financial-charge';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  listLinkOffers,
  resolveOrderBumps,
  sumOffers,
  toOfferView,
  type OfferView,
} from './payment-link-offers.helper';

type FunnelOfferView = OfferView & { valorCartao: number };

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
    private readonly prisma: PrismaService,
  ) {}

  /**
   * @param orderBumpIds order bumps marcados pelo comprador — quando informados, as opções de
   * parcelamento/valores são recalculadas sobre (valor do link + order bumps).
   */
  async execute(
    id: string,
    orderBumpIds?: string[],
  ): Promise<{
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
    /** Valor base efetivamente cobrado (link + order bumps selecionados), antes de juros */
    valorComOfertas: number;
    orderBumpsSelecionados: string[];
    ofertas: {
      orderBumps: OfferView[];
      upsell: FunnelOfferView | null;
      downsell: FunnelOfferView | null;
    };
  }> {
    const link = await this.links.findById(id);
    const isExpired =
      Boolean((link as any)?.expiresAt) &&
      new Date((link as any).expiresAt).getTime() <= Date.now();
    if (!link || !link.isActive || isExpired) {
      throw new NotFoundException(
        'Link de pagamento não encontrado ou inativo',
      );
    }

    const linkPlataformas = (link as any).plataformas as string[] | undefined;
    const platformTag = linkPlataformas?.[0]?.toUpperCase() ?? 'GLOBAL';

    // Validate platform lifecycle without resolving another platform from user identity.
    platformGatewayToken(platformTag, 'public-global');

    const financialContext = await loadChargePolicy(this.prisma, platformTag);
    const quote = (
      amount: number,
      method: 'PIX' | 'DEBIT_CARD' | 'CREDIT_CARD',
      installments = 1,
    ) => {
      const result = quoteFinancialCharge(
        financialContext,
        amount,
        method,
        installments,
      );
      if (!result) {
        throw new BadRequestException(
          'Taxas da plataforma não configuradas para esta modalidade',
        );
      }
      return result;
    };
    const offers = await listLinkOffers(this.prisma, link.id, true);
    const selectedBumps = await resolveOrderBumps(
      this.prisma,
      link.id,
      orderBumpIds,
    );
    const chargedBase = Number(link.amount) + sumOffers(selectedBumps);
    const funnelView = (
      type: 'UPSELL' | 'DOWNSELL',
    ): FunnelOfferView | null => {
      const offer = offers.find((o) => o.type === type);
      if (!offer || !(link.aceitaCartao ?? true)) return null;
      // Upsell/downsell no cartão são cobrados à vista (1x).
      const card = quote(Number(offer.price), 'CREDIT_CARD');
      return { ...toOfferView(offer), valorCartao: card.totalAmount };
    };

    const maxInstallments = link.maxInstallments;
    const opcoesParcelas: InstallmentOption[] = [];

    for (let i = 1; (link.aceitaCartao ?? true) && i <= maxInstallments; i++) {
      const f = quote(chargedBase, 'CREDIT_CARD', i);
      opcoesParcelas.push({
        parcelas: i,
        taxaJurosPlatforma: f.platformFeeRate,
        valorJurosPlatforma: f.interestAmount,
        taxaDom: f.domFeeRate * 100,
        valorTaxaDom: 0,
        valorTotal: f.totalAmount,
        valorParcela: f.installmentAmount,
        temJuros: f.platformFeeRate > 0,
      });
    }

    const debitQuote =
      (link.aceitaDebito ?? true) ? quote(chargedBase, 'DEBIT_CARD') : null;
    const debitCalc = debitQuote;

    // Para PIX, o cliente paga o valor base sem acréscimo de taxa de crédito.
    // A taxa de processamento PIX (MDR_PIX) fica do lado do vendedor, igual ao débito.
    const valorPix =
      (link.aceitaPix ?? true)
        ? quote(chargedBase, 'PIX').totalAmount
        : chargedBase;

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
      dataExpiracao: (link as any).expiresAt
        ? (link as any).expiresAt.toISOString()
        : null,
      redirectUrl: (link as any).redirectUrl ?? null,
      opcoesParcelas,
      valorPix,
      valorDebito: debitQuote?.totalAmount ?? chargedBase,
      platformTag,
      debitFeePercent: debitCalc?.platformFeePercent ?? 0,
      debitFeeFixed: debitCalc?.platformFeeFixed ?? 0,
      debitTaxaDomPercent: debitCalc?.domFeePercent ?? 0,
      debitTaxaDomFixed: debitCalc?.domFeeFixed ?? 0,
      debitTotalFee: 0,
      debitNetAmount: 0,
      valorComOfertas: chargedBase,
      orderBumpsSelecionados: selectedBumps.map((o) => o.id),
      ofertas: {
        orderBumps: offers
          .filter((o) => o.type === 'ORDER_BUMP')
          .map(toOfferView),
        upsell: funnelView('UPSELL'),
        downsell: funnelView('DOWNSELL'),
      },
    };
  }
}
