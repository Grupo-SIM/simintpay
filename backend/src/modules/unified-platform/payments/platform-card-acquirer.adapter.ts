import { markChargeAttempt } from './dom-rejection';
import { postDomCheckout } from './dom-checkout.acquirer';
import {
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PlatformPaymentCardDto,
  PlatformPaymentCustomerDto,
} from './platform-payment.dto';

/** Direct card checkout capability. No implicit fallback to another acquirer. */
export function resolveCardAcquirer(acquirer: string) {
  if (acquirer !== 'DOM')
    throw new UnprocessableEntityException({
      code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
      capability: 'payments.CREDIT_CARD',
      acquirer,
    });
  return {
    async charge(
      token: string,
      input: {
        id: string;
        amountCents: number;
        description: string;
        customer: PlatformPaymentCustomerDto;
        card: PlatformPaymentCardDto;
      },
    ) {
      const amount = new Prisma.Decimal(input.amountCents).div(100);
      const response = await postDomCheckout(token, {
        cod_external: input.id,
        customer: {
          name: input.customer.name,
          email: input.customer.email,
          document: input.customer.document.replace(/\D/g, ''),
          document_type: input.customer.documentType,
          mobile_phone: input.customer.phone ?? '',
        },
        items: {
          description: input.description,
          price: amount.toNumber(),
          quantity: 1,
        },
        payment: {
          payment_method: 'credit_card',
          total: amount.toNumber(),
          credit_card: {
            token: input.card.token,
            holder_name: input.card.holderName,
            bin: input.card.bin,
            brand: input.card.brand,
            installments: input.card.installments,
            installment_amount: amount
              .div(input.card.installments)
              .toDecimalPlaces(2)
              .toNumber(),
          },
        },
      });
      if (!response.ok) {
        const failure = new BadGatewayException({
          code: 'ACQUIRER_PAYMENT_FAILED',
        });
        throw markChargeAttempt(failure, {
          provider: 'DOM',
          httpStatus: response.status,
          providerCode:
            response.data &&
            typeof response.data === 'object' &&
            'code' in response.data &&
            typeof response.data.code === 'string'
              ? response.data.code
              : undefined,
        });
      }
      const payment = response.data;
      if (typeof payment?.id !== 'string' || !payment.id)
        throw markChargeAttempt(
          new BadGatewayException({ code: 'ACQUIRER_INVALID_RESPONSE' }),
          { provider: 'DOM', httpStatus: response.status },
        );
      return {
        id: payment.id,
        status: String(payment.status ?? '').toLowerCase(),
        pixContent: null,
        qrCode: null,
        pixExpire: null,
      };
    },
  };
}
