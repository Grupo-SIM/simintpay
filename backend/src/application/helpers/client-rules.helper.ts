import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { buildUserTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';

/** Valor mínimo (R$) que um cliente SimintPay pode usar ao criar link/plano. Configurável via env CLIENT_MIN_AMOUNT. */
export const CLIENT_MIN_AMOUNT = Number(process.env.CLIENT_MIN_AMOUNT) || 14.99;

type ClientUserLike = {
  id?: string;
  email: string;
  clientStatus?: string | null;
};

/** True se a conta é um cliente SimintPay (auto-cadastrado, qualquer status). */
export function isClientUser(user: ClientUserLike | null | undefined): boolean {
  return !!user && user.clientStatus != null;
}

/** Durable fee identity of the merchant; legacy email overrides are fallback only. */
export function clientTaxaTagFor(
  user: ClientUserLike | null | undefined,
): string | null {
  return user?.id ? buildUserTaxaTag(user.id) : null;
}

/**
 * Aplica as regras de criação para clientes. No-op se a conta não for cliente.
 * - cliente não-APPROVED → 403 (conta em análise)
 * - valor < CLIENT_MIN_AMOUNT → 400
 */
export function assertClientCanCreate(
  user: ClientUserLike | null | undefined,
  amount: number,
): void {
  if (!isClientUser(user)) return;
  if (user!.clientStatus !== 'APPROVED') {
    throw new ForbiddenException(
      'Sua conta está em análise. Aguarde a aprovação para criar links e planos.',
    );
  }
  if (!(Number(amount) >= CLIENT_MIN_AMOUNT)) {
    throw new BadRequestException('O valor mínimo é R$ 14,99');
  }
}
