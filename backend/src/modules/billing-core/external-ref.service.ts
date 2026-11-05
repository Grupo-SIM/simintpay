import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export type ExternalRefKind =
  | 'PLAN'
  | 'SUBSCRIPTION'
  | 'PAYMENT_LINK'
  | 'PAYMENT'
  | 'CUSTOMER'
  | 'CARD_TOKEN';

export type ExternalRefTarget = { entityType: string; entityId: string };

/**
 * Resolve identificadores do adquirente para entidades internas. Código novo
 * usa isto em vez de colunas `dom*`, para que trocar de adquirente não exija
 * alterar as tabelas donas do dado.
 */
@Injectable()
export class ExternalRefService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotente: repetir o mesmo vínculo é aceito; apontar para outra entidade falha. */
  async link(
    acquirerCode: string,
    kind: ExternalRefKind,
    externalId: string,
    target: ExternalRefTarget,
  ): Promise<void> {
    const where = {
      acquirerCode_kind_externalId: { acquirerCode, kind, externalId },
    };
    const existing = await this.prisma.externalRef.findUnique({ where });
    if (existing) {
      if (
        existing.entityType !== target.entityType ||
        existing.entityId !== target.entityId
      ) {
        throw new Error(
          `Referência externa ${acquirerCode}/${kind}/${externalId} já pertence a outra entidade`,
        );
      }
      return;
    }
    await this.prisma.externalRef.create({
      data: { acquirerCode, kind, externalId, ...target },
    });
  }

  async resolve(
    acquirerCode: string,
    kind: ExternalRefKind,
    externalId: string,
  ): Promise<ExternalRefTarget | null> {
    const ref = await this.prisma.externalRef.findUnique({
      where: {
        acquirerCode_kind_externalId: { acquirerCode, kind, externalId },
      },
    });
    return ref ? { entityType: ref.entityType, entityId: ref.entityId } : null;
  }

  /** ID do adquirente para uma entidade interna, se houver. */
  async externalIdFor(
    target: ExternalRefTarget,
    acquirerCode: string,
    kind: ExternalRefKind,
  ): Promise<string | null> {
    const ref = await this.prisma.externalRef.findUnique({
      where: {
        entityType_entityId_acquirerCode_kind: {
          ...target,
          acquirerCode,
          kind,
        },
      },
    });
    return ref?.externalId ?? null;
  }
}
