import { resolveFinancialOwner } from '../../helpers/financial-owner.helper';
import { platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { CreateBoletoDto } from '../../dtos/boleto/create-boleto.dto';
import {
  assertClientCanCreate,
  clientTaxaTagFor,
} from '../../helpers/client-rules.helper';

@Injectable()
export class CreateBoletoUseCase {
  constructor(
    @Inject(BOLETO_REPOSITORY)
    private readonly boletos: IBoletoRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async execute(input: { userId: string; dto: CreateBoletoDto }): Promise<{
    data: {
      id: string;
      codigo: string;
      titulo: string;
      descricao: string | null;
      valor: number;
      vencimentoDias: number;
      dataExpiracao: string | null;
      ativo: boolean;
      link: string | null;
      criadoEm: string;
    };
  }> {
    // Cliente SimintPay: bloqueia não-aprovado e exige mínimo.
    const {
      owner: user,
      platformTag: selectedTag,
      createdByUserId,
    } = await resolveFinancialOwner(this.users, input.userId, {
      ...input.dto,
      platforms: input.dto.plataformas,
    });
    assertClientCanCreate(user, input.dto.valor);
    const clientTag = clientTaxaTagFor(user);

    const domToken = platformGatewayToken(selectedTag, process.env.DOM_TOKEN);

    if (!domToken) {
      throw new UnauthorizedException(
        'Token DOM não encontrado para este usuário/módulo',
      );
    }

    const vencimentoDias = input.dto.vencimentoDias ?? 3;

    // Cria na DOM um link de pagamento com boleto + pix (à vista, sem cartão).
    const created = await this.gateway.createPaymentLink(domToken, {
      title: input.dto.titulo,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      maxInstallments: 1,
      aceitaCartao: false,
      aceitaPix: true,
      aceitaBoleto: true,
      boletoExpireDay: vencimentoDias,
    });

    const saved = await this.boletos.create({
      coproduction: input.dto.coproduction,
      userId: user.id,
      createdByUserId,
      title: input.dto.titulo,
      description: input.dto.descricao ?? null,
      amount: input.dto.valor,
      expiresAt: input.dto.dataExpiracao
        ? new Date(input.dto.dataExpiracao)
        : null,
      vencimentoDias,
      isActive: true,
      webhookUrl: input.dto.webhookUrl ?? null,
      redirectUrl: input.dto.redirectUrl ?? null,
      maxUses: input.dto.maxUses ?? null,
      domPaymentLinkId: created.id,
      domLink: created.code ?? null,
      // Cliente SimintPay: atribui a plataforma "SIMINTPAY" (exibição/agrupamento). A taxa
      // continua resolvendo pela tag do dono — este campo não altera a cobrança.
      plataformas: selectedTag ? [selectedTag] : clientTag ? ['SIMINTPAY'] : [],
    });

    return {
      data: {
        id: saved.id,
        codigo: saved.code,
        titulo: saved.title,
        descricao: saved.description ?? null,
        valor: Number(saved.amount),
        vencimentoDias: saved.vencimentoDias,
        dataExpiracao: saved.expiresAt ? saved.expiresAt.toISOString() : null,
        ativo: saved.isActive,
        link: saved.domLink ?? null,
        criadoEm: saved.createdAt.toISOString(),
      },
    };
  }
}
