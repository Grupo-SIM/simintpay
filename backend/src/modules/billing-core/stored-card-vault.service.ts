import { Injectable } from '@nestjs/common';
import type { StoredCard } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  decryptPlatformSecret,
  encryptPlatformSecret,
} from '../platform-integrations/platform-secrets';

export type SaveStoredCardInput = {
  ownerUserId: string;
  contractId?: string | null;
  customerEmail: string;
  acquirerCode: string;
  /** Token reutilizável emitido pelo adquirente. Nunca PAN/CVV. */
  token: string;
  brand?: string | null;
  last4: string;
  expMonth: number;
  expYear: number;
};

/**
 * Cofre de cartões da SimIntPay. Guarda apenas tokens reutilizáveis emitidos por
 * cada adquirente (cifrados) e metadados de exibição; PAN e CVV nunca chegam aqui.
 */
@Injectable()
export class StoredCardVaultService {
  constructor(private readonly prisma: PrismaService) {}

  /** Salva o token após um checkout com tokenização bem-sucedido. Revoga o cartão ativo anterior do contrato. */
  async save(input: SaveStoredCardInput): Promise<StoredCard> {
    if (!/^\d{4}$/.test(input.last4)) throw new Error('last4 inválido');
    if (!input.token) throw new Error('Token do adquirente obrigatório');
    const encryptedToken = encryptPlatformSecret(input.token);
    return this.prisma.$transaction(async (tx) => {
      if (input.contractId) {
        await tx.storedCard.updateMany({
          where: { contractId: input.contractId, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
      }
      return tx.storedCard.create({
        data: {
          ownerUserId: input.ownerUserId,
          contractId: input.contractId ?? null,
          customerEmail: input.customerEmail.trim().toLowerCase(),
          brand: input.brand ?? null,
          last4: input.last4,
          expMonth: input.expMonth,
          expYear: input.expYear,
          tokens: {
            create: { acquirerCode: input.acquirerCode, encryptedToken },
          },
        },
      });
    });
  }

  /** Acrescenta (ou substitui) o token de outro adquirente para o mesmo cartão. */
  async addToken(
    storedCardId: string,
    acquirerCode: string,
    token: string,
  ): Promise<void> {
    const encryptedToken = encryptPlatformSecret(token);
    await this.prisma.storedCardToken.upsert({
      where: { storedCardId_acquirerCode: { storedCardId, acquirerCode } },
      update: { encryptedToken },
      create: { storedCardId, acquirerCode, encryptedToken },
    });
  }

  /** Token decifrado do cartão ativo do contrato para o adquirente, ou null. Nunca registrar o retorno. */
  async resolveForContract(
    contractId: string,
    acquirerCode: string,
    now: Date = new Date(),
  ): Promise<{ storedCardId: string; token: string } | null> {
    const card = await this.prisma.storedCard.findFirst({
      where: { contractId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: { tokens: { where: { acquirerCode } } },
    });
    const row = card?.tokens[0];
    if (!card || !row) return null;
    // Cartão vencido não é cobrado: o comprador precisa trocar.
    const expiresAt = Date.UTC(card.expYear, card.expMonth, 1);
    if (expiresAt <= now.getTime()) return null;
    return {
      storedCardId: card.id,
      token: decryptPlatformSecret(row.encryptedToken),
    };
  }

  async revoke(storedCardId: string): Promise<void> {
    await this.prisma.storedCard.updateMany({
      where: { id: storedCardId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
  }
}
