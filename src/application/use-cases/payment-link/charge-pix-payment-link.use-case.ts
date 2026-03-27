import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { getModuleDomToken } from '../../../modules/module.registry';

export type ChargePixPaymentLinkInput = {
  linkId: string;
  customerName: string;
  customerEmail: string;
  customerDocument: string;
  customerPhone?: string;
  documentType?: 'CPF' | 'CNPJ';
};

export type ChargePixPaymentLinkOutput = {
  id: string;
  status: string;
  pixContent: string | null;
  qrCode: string | null;
  pixExpire: string | null;
  amount: number;
};

@Injectable()
export class ChargePixPaymentLinkUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: ChargePixPaymentLinkInput): Promise<ChargePixPaymentLinkOutput> {
    const link = await this.links.findById(input.linkId);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link de pagamento não encontrado ou inativo');
    }
    if ((link as any).expiresAt && new Date((link as any).expiresAt).getTime() <= Date.now()) {
      throw new NotFoundException('Link de pagamento expirado');
    }
    if (!link.domPaymentLinkId) {
      throw new BadRequestException('Link ainda não sincronizado com o gateway');
    }
    if (!link.aceitaPix) {
      throw new BadRequestException('Este link não aceita pagamento via PIX');
    }

    const owner = await this.users.findById(link.userId);
    let domToken: string | null | undefined = owner?.domToken;

    if (!domToken && owner?.tenantModule?.slug) {
      domToken = getModuleDomToken(owner.tenantModule.slug);
    }

    if (!domToken) domToken = process.env.DOM_TOKEN;

    if (!domToken) {
      throw new BadRequestException('Token do gateway não configurado');
    }

    const document = input.customerDocument.replace(/\D/g, '');
    const documentType = input.documentType ?? (document.length === 14 ? 'CNPJ' : 'CPF');
    const phone = (input.customerPhone ?? '').replace(/\D/g, '');
    const codExternal = `pix-link-${link.id}-${Date.now()}`;
    const amountInReais = Number(link.amount);

    const result = await this.gateway.chargePixForLink(domToken, {
      domLinkId: link.domPaymentLinkId,
      amount: amountInReais,
      description: link.title,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerDocument: document,
      customerPhone: phone,
      documentType,
      codExternal,
    });

    return result;
  }
}
