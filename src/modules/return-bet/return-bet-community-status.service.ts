import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export interface CommunityStatusResult {
  isActive: boolean;
  expiresAt: string | null;
}

/** Tag usada no SubscriptionLink "Vivendo de Bet" (platformTag). Confirmado via
 * inspeção direta do banco de produção em 2026-08-14. */
const VIVENDO_DE_BET_PLATFORM_TAG = 'VIVENDO-DE-BET';

@Injectable()
export class ReturnBetCommunityStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async checkOne(input: { cpf?: string; email?: string }): Promise<CommunityStatusResult> {
    const cpf = input.cpf?.trim() || undefined;
    const email = input.email?.trim().toLowerCase() || undefined;
    if (!cpf && !email) return { isActive: false, expiresAt: null };

    const link = await this.prisma.subscriptionLink.findFirst({
      where: { platformTag: VIVENDO_DE_BET_PLATFORM_TAG },
      select: { id: true },
    });
    if (!link) return { isActive: false, expiresAt: null };

    const order = await this.prisma.subscriptionLinkOrder.findFirst({
      where: {
        subscriptionLinkId: link.id,
        ...(cpf ? { customerDocument: cpf } : { customerEmail: email }),
      },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    if (!order) return { isActive: false, expiresAt: null };

    // SubscriptionLinkOrder não tem campo de expiração — status é a única fonte
    // de verdade, atualizado via webhook DOM.
    return { isActive: order.status.toLowerCase() === 'active', expiresAt: null };
  }
}
