import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { getModuleDomToken } from '../../../modules/module.registry';

export type ChargePaymentLinkInput = {
  linkId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone: string;
  paymentMethod?: 'credit_card' | 'pix';
  installments?: number;
  card?: {
    token: string;
    brand?: string;
    bin?: string;
    exp_month: string;
    exp_year: string;
    cvv: string;
    holder_name: string;
    holder_document: string;
    number?: string;
  };
};

@Injectable()
export class ChargePaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: ChargePaymentLinkInput): Promise<{
    id: string;
    status: string;
    pixContent: string | null;
    redirectUrl: string | null;
  }> {
    const link = await this.links.findById(input.linkId);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link de pagamento não encontrado ou inativo');
    }
    if (!link.domPaymentLinkId) {
      throw new BadRequestException('Link ainda não sincronizado com o gateway');
    }

    // Resolve domToken: usuário individual > módulo > DOM_TOKEN global
    const owner = await this.users.findById(link.userId);
    let domToken: string | null | undefined = owner?.domToken;

    if (!domToken && owner?.tenantModule?.slug) {
      domToken = getModuleDomToken(owner.tenantModule.slug);
    }

    if (!domToken) {
      domToken = process.env.DOM_TOKEN;
    }

    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const result = await this.gateway.chargePaymentLink(domToken, {
      domLinkId: link.domPaymentLinkId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: input.customerDocument.replace(/\D/g, ''),
      customerPhone: input.customerPhone.replace(/\D/g, ''),
      paymentMethod: input.paymentMethod ?? 'credit_card',
      installments: input.installments ?? 1,
      card: input.card,
    });

    return {
      id: result.id,
      status: result.status ?? 'pending',
      pixContent: result.pixContent ?? null,
      redirectUrl: null,
    };
  }
}
