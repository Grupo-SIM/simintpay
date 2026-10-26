import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
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

  async execute(input: { userId: string; id?: string; dto: CreatePaymentLinkDto; allowLocalCheckout?: boolean }): Promise<{
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
    const selectedTag = assertExplicitPlatform(user, input.dto.plataformas, true);
    const clientTag = selectedTag ? null : clientTaxaTagFor(user);

    const domToken = platformGatewayToken(selectedTag ?? user?.platform?.tag, process.env.DOM_TOKEN);

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
    }).catch(error => {
      // BetAI's registered-platform contract keeps a local checkout if optional
      // DOM link registration fails. It never switches acquirer or owner.
      if (!input.allowLocalCheckout) throw error;
      return null;
    });

    const saved = await this.links.create({
      coproduction: input.dto.coproduction,
      ...(input.id ? { id: input.id } : {}),
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
      webhookUrl: input.dto.webhookUrl ?? null,
      redirectUrl: input.dto.redirectUrl ?? null,
      maxUses: input.dto.maxUses ?? null,
      domPaymentLinkId: created?.id ?? null,
      emailBody: input.dto.emailBody ?? null,
      // Cliente SimintPay: atribui a plataforma "SIMINTPAY" (exibição/agrupamento) para o
      // link não ficar sem plataforma. A taxa continua resolvendo pela tag do dono
      // (CLIENT:<email> → herda da SIM INT PAY/GLOBAL) — este campo não altera a cobrança.
      plataformas: selectedTag ? [selectedTag] : clientTag ? ['SIMINTPAY'] : [],
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
