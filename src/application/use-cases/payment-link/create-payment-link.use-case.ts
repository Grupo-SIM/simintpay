import { Inject, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { CreatePaymentLinkDto } from '../../dtos/payment-link/create-payment-link.dto';
import { getModuleDomToken } from '../../../modules/module.registry';
import { assertClientCanCreate, clientTaxaTagFor } from '../../helpers/client-rules.helper';

@Injectable()
export class CreatePaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async execute(input: { userId: string; dto: CreatePaymentLinkDto }): Promise<{
    data: {
      id: string;
      codigo: string;
      titulo: string;
      descricao: string | null;
      valor: number;
      dataExpiracao: string | null;
      parcelasMax: number;
      ativo: boolean;
      isStandalone: boolean;
      criadoEm: string;
    };
  }> {
    // Cliente SimintPay: bloqueia não-aprovado e exige mínimo.
    const user = await this.users.findById(input.userId);
    assertClientCanCreate(user, input.dto.valor);
    const clientTag = clientTaxaTagFor(user);

    // Resolve domToken: cliente SimintPay SEMPRE usa o token mestre; senão usuário > módulo > global.
    let domToken: string | null | undefined = clientTag ? process.env.DOM_TOKEN : user?.domToken;

    if (!domToken && !clientTag && user?.tenantModule?.slug) {
      domToken = getModuleDomToken(user.tenantModule.slug);
    }

    if (!domToken) {
      domToken = process.env.DOM_TOKEN;
    }

    if (!domToken) {
      throw new UnauthorizedException('Token DOM não encontrado para este usuário/módulo');
    }

    const aceitaCartao = input.dto.aceitaCartao ?? true;
    const aceitaDebito = input.dto.aceitaDebito ?? true;
    const aceitaPix = input.dto.aceitaPix ?? true;
    const maxInstallments = aceitaCartao ? (input.dto.parcelasMax ?? 1) : 1;
    const isStandalone = input.dto.isStandalone ?? true;

    // Taxa de juros DOM para o número máximo de parcelas (para registro no gateway)
    let interestRate = 0;
    try {
      const masterKey = process.env.API_DOM_MASTER_KEY;
      if (masterKey) {
        const taxes = await this.gateway.getTaxes(masterKey);
        const parcelas = taxes?.cartaoCredito?.tabelaParcelas ?? [];
        const row = parcelas.find((r) => Number(r.parcelas) === maxInstallments);
        if (row) {
          interestRate = parseFloat(row.taxaDom) || 0;
        }
      }
    } catch {
      // Se falhar ao buscar taxas, segue com 0 (não bloqueia a criação)
    }

    const created = await this.gateway.createPaymentLink(domToken, {
      title: input.dto.titulo,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      maxInstallments,
      interestRateInstallment: interestRate,
      aceitaCartao,
      aceitaPix,
    });

    const saved = await this.links.create({
      userId: input.userId,
      title: input.dto.titulo,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      expiresAt: input.dto.dataExpiracao ? new Date(input.dto.dataExpiracao) : null,
      maxInstallments,
      aceitaCartao,
      aceitaDebito,
      aceitaPix,
      isActive: true,
      isStandalone,
      platformFee1x: input.dto.platformFee1x,
      platformFee2x: input.dto.platformFee2x,
      platformFee3x: input.dto.platformFee3x,
      platformFee4x: input.dto.platformFee4x,
      platformFee5x: input.dto.platformFee5x,
      platformFee6x: input.dto.platformFee6x,
      platformFee7x: input.dto.platformFee7x,
      platformFee8x: input.dto.platformFee8x,
      platformFee9x: input.dto.platformFee9x,
      platformFee10x: input.dto.platformFee10x,
      platformFee11x: input.dto.platformFee11x,
      platformFee12x: input.dto.platformFee12x,
      cashbackFee: input.dto.cashbackFee,
      debitFeePercent: input.dto.debitFeePercent,
      debitFeeFixed: input.dto.debitFeeFixed,
      webhookUrl: input.dto.webhookUrl ?? null,
      redirectUrl: input.dto.redirectUrl ?? null,
      maxUses: input.dto.maxUses ?? null,
      domPaymentLinkId: created.id,
      emailBody: input.dto.emailBody ?? null,
      // Cliente SimintPay: atribui a plataforma "SIMINTPAY" (exibição/agrupamento) para o
      // link não ficar sem plataforma. A taxa continua resolvendo pela tag do dono
      // (CLIENT:<email> → herda da SIM INT PAY/GLOBAL) — este campo não altera a cobrança.
      plataformas: clientTag ? ['SIMINTPAY'] : (input.dto.plataformas ?? []),
    });

    return {
      data: {
        id: saved.id,
        codigo: saved.code,
        titulo: saved.title,
        descricao: saved.description ?? null,
        valor: Number(saved.amount),
        dataExpiracao: (saved as any).expiresAt ? (saved as any).expiresAt.toISOString() : null,
        parcelasMax: saved.maxInstallments,
        ativo: saved.isActive,
        isStandalone: saved.isStandalone,
        criadoEm: saved.createdAt.toISOString(),
      },
    };
  }
}
