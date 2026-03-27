import { Inject, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { CreatePaymentLinkDto } from '../../dtos/payment-link/create-payment-link.dto';
import { getModuleDomToken } from '../../../modules/module.registry';

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
      criadoEm: string;
    };
  }> {
    // Resolve domToken: usuário individual > módulo > variável global DOM_TOKEN
    const user = await this.users.findById(input.userId);
    let domToken: string | null | undefined = user?.domToken;

    if (!domToken && user?.tenantModule?.slug) {
      domToken = getModuleDomToken(user.tenantModule.slug);
    }

    if (!domToken) {
      domToken = process.env.DOM_TOKEN;
    }

    if (!domToken) {
      throw new UnauthorizedException('Token DOM não encontrado para este usuário/módulo');
    }

    // Busca taxas para obter interest_rate_installment correto por número de parcelas
    const aceitaCartao = input.dto.aceitaCartao ?? true;
    const aceitaPix = input.dto.aceitaPix ?? true;
    const maxInstallments = aceitaCartao ? (input.dto.parcelasMax ?? 1) : 1;
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
      aceitaPix,
      isActive: true,
      domPaymentLinkId: created.id,
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
        criadoEm: saved.createdAt.toISOString(),
      },
    };
  }
}
