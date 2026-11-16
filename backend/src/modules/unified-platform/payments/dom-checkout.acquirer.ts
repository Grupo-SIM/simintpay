import { BadRequestException } from '@nestjs/common';
import { markPreDispatchNoCharge } from './dom-rejection';
import { isDomCashbackActive } from '../../platform-taxas/platform-taxas.store';

/** Desligado para o escopo, a transação vai com `payment.cashback_disabled` (exige autorização da DOM). */
function withCashbackScope(request: unknown, scope: string) {
  if (isDomCashbackActive(scope)) return request;
  const body = request as { payment?: Record<string, unknown> };
  return { ...body, payment: { ...body.payment, cashback_disabled: true } };
}

/** DOM transport only. Business rules, credentials and financial writes stay outside. */
export async function postDomCheckout(
  token: string | undefined,
  request: unknown,
  /** Tag de política da cobrança (plataforma); cashback desligado nela é desativado na DOM. */
  cashbackScope = 'GLOBAL',
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
      body: JSON.stringify(withCashbackScope(request, cashbackScope)),
    },
  );
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json(),
  };
}
