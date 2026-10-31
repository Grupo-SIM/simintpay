import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';
import { unsupportedCapability } from './platform-adapters';
import type { PlatformContext } from './platform-context.service';

export class PlatformReconciliation {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconcilePendingTransactionsUseCase,
  ) {}
  async run(
    tag: string,
    hours = 720,
    userId?: string,
    context?: PlatformContext,
  ) {
    if (!Number.isFinite(hours) || hours < 1 || hours > 8760)
      throw new BadRequestException('Janela de reconciliação inválida');
    const platform = await this.prisma.platform.findUnique({
      where: { tag },
      include: { owner: true, integrations: true },
    });
    if (
      !platform?.isActive ||
      !platform.owner.isActive ||
      platform.owner.isPurged ||
      (context &&
        (context.id !== platform.id ||
          context.ownerUserId !== platform.ownerUserId))
    )
      throw new ConflictException('Plataforma ou dono inativo/alterado');
    if (platform.acquirer !== 'DOM')
      unsupportedCapability('reconcile.' + platform.acquirer);
    const credential = platform.integrations.find(
      (row) => row.key === 'DOM_TOKEN',
    );
    const token = credential?.encryptedValue
      ? decryptPlatformSecret(credential.encryptedValue)
      : credential?.url;
    if (!token) unsupportedCapability('reconcile.configuration');
    return this.reconciliation.execute({
      platformTag: tag,
      userId: context ? context.ownerUserId : userId,
      sinceHours: hours,
      limit: 500,
      direct: true,
      domToken: token,
    });
  }
}
