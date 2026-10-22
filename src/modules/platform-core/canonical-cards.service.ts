import { Injectable, BadGatewayException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { PlatformContext } from './platform-context.service';
import { deliveryProfile } from './delivery-profile';
import type { CanonicalCardDto, CanonicalCustomerDto } from './canonical-cards.dto';

const DOM_URL = 'https://apiv3.dompagamentos.com.br/checkout/production';
function brand(number: string) {
  if (number.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(number) || +number.slice(0, 4) >= 2221 && +number.slice(0, 4) <= 2720) return 'Mastercard';
  if (/^3[47]/.test(number)) return 'American Express';
  if (number.startsWith('6')) return 'Discover';
  return 'Unknown';
}
@Injectable()
export class CanonicalCardsService {
  constructor(private readonly prisma: PrismaService) {}
  async customer(context: PlatformContext, input: CanonicalCustomerDto) {
    const { token, credential } = await deliveryProfile(this.prisma, context);
    const where = { credentialId_externalCustomerId: { credentialId: credential.id, externalCustomerId: input.externalCustomerId } };
    const saved = await this.prisma.canonicalCardCustomer.findUnique({ where });
    if (saved) return { id: saved.id };
    const response = await fetch(`${DOM_URL}/customers`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code_external: input.externalCustomerId, name: input.name, email: input.email, document: input.document, document_type: input.document.length === 11 ? 'CPF' : 'CNPJ', mobile_phone: input.phone }), signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null);
    // DOM may return the existing customer id on a duplicate response.
    const providerCustomerId = data?.id ?? data?.data?.id;
    if (typeof providerCustomerId !== 'string' || !providerCustomerId) throw new BadGatewayException({ code: 'CUSTOMER_PROVISION_FAILED' });
    const result = await this.prisma.canonicalCardCustomer.upsert({ where, create: { credentialId: credential.id, externalCustomerId: input.externalCustomerId, providerCustomerId }, update: {} });
    return { id: result.id };
  }
  async tokenize(context: PlatformContext, customerId: string, input: CanonicalCardDto) {
    const { token, credential } = await deliveryProfile(this.prisma, context);
    const customer = await this.prisma.canonicalCardCustomer.findFirst({ where: { id: customerId, credentialId: credential.id } });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    const response = await fetch(`${DOM_URL}/customers/${encodeURIComponent(customer.providerCustomerId)}/card-token`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: input.number, cvv: input.cvv, exp_month: input.expMonth, exp_year: input.expYear, holder_name: input.holderName, holder_document: input.holderDocument }), signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null);
    const cardToken = data?.token ?? data?.data?.token;
    if (!response.ok || typeof cardToken !== 'string' || !cardToken) throw new BadGatewayException({ code: 'CARD_TOKENIZATION_FAILED' });
    return { token: cardToken, bin: input.number.slice(0, 6), last4: input.number.slice(-4), brand: brand(input.number), holderName: input.holderName,
      expiryMonth: String(input.expMonth).padStart(2, '0'), expiryYear: String(input.expYear), customerId: customer.id };
  }
}
