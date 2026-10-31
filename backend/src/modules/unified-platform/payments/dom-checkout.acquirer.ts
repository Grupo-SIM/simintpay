import { BadRequestException } from '@nestjs/common';
import { markPreDispatchNoCharge } from './dom-rejection';

/** DOM transport only. Business rules, credentials and financial writes stay outside. */
export async function postDomCheckout(
  token: string | undefined,
  request: unknown,
) {
  if (!token)
    throw markPreDispatchNoCharge(
      new BadRequestException('Credencial da plataforma não configurada'),
    );
  const response = await fetch(
    'https://apiv3.dompagamentos.com.br/checkout/production/transactions',
    {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
        ...(process.env.API_BASE_URL
          ? { Origin: process.env.API_BASE_URL }
          : {}),
      },
      body: JSON.stringify(request),
    },
  );
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json(),
  };
}
