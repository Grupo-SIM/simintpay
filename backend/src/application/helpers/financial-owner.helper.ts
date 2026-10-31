import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { getRegisteredPlatform } from '../../modules/module.registry';
import { canonicalPlatformTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';
import { assertExplicitPlatform } from './explicit-platform.helper';

type Account = {
  id: string;
  email: string;
  role?: string;
  isActive?: boolean;
  clientStatus?: string | null;
};
type Accounts = {
  findById(id: string): Promise<any>;
  findByEmail(email: string): Promise<any>;
};

/** Authorization belongs to the actor; proceeds and commercial rules belong to the registered owner. */
export async function resolveFinancialOwner(
  users: Accounts,
  actorId: string,
  target: { ownerUserId?: string; email?: string; platforms?: string[] },
) {
  const actor = await users.findById(actorId);
  if (!actor || actor.isActive === false)
    throw new UnauthorizedException('Conta não encontrada ou inativa');
  const platformTag = assertExplicitPlatform(actor, target.platforms, true);
  const platform = platformTag ? getRegisteredPlatform(platformTag) : null;
  let requested: Account | null = target.ownerUserId
    ? await users.findById(target.ownerUserId)
    : null;
  if (target.ownerUserId && !requested)
    throw new BadRequestException('Titular não encontrado');
  if (target.email) {
    const byEmail = await users.findByEmail(target.email);
    if (!byEmail || (requested && requested.id !== byEmail.id))
      throw new BadRequestException('Destinatários conflitantes');
    requested = byEmail;
  }
  if (platform && requested && requested.id !== platform.ownerUserId)
    throw new BadRequestException('Titular difere do dono da plataforma');
  const ownerId =
    platform?.ownerUserId ??
    requested?.id ??
    (actor.role === 'ADMIN' ? null : actor.id);
  if (!ownerId)
    throw new BadRequestException(
      'Selecione um titular ou uma plataforma cadastrada',
    );
  if (
    actor.role !== 'ADMIN' &&
    requested &&
    requested.id !== (platform?.ownerUserId ?? actor.id)
  )
    throw new ForbiddenException('Titular não autorizado');
  const owner = ownerId === actor.id ? actor : await users.findById(ownerId);
  if (!owner || owner.isActive === false || owner.role === 'ADMIN')
    throw new BadRequestException(
      'Titular deve ser uma conta não administrativa ativa',
    );
  return { actor, owner, platformTag, createdByUserId: actor.id };
}

/** Product edits cannot implicitly transfer financial ownership or gateway context. */
export function assertOwnershipPreserved(
  existing: {
    userId: string;
    plataformas?: string[];
    platformTag?: string | null;
    tenantTag?: string | null;
  },
  dto: {
    ownerUserId?: string;
    plataformas?: string[];
    platformTag?: string | null;
    tenantTag?: string | null;
  },
) {
  if (dto.ownerUserId !== undefined && dto.ownerUserId !== existing.userId)
    throw new BadRequestException(
      'Reatribuição financeira exige operação administrativa auditada',
    );
  const normalize = (tags: (string | null | undefined)[]) => {
    const values = [
      ...new Set(
        tags
          .filter((tag): tag is string => Boolean(tag))
          .map((tag) => canonicalPlatformTaxaTag(tag.replaceAll('_', '-')))
          .filter((tag) => !['GLOBAL', 'SIMINTPAY'].includes(tag)),
      ),
    ];
    if (values.length > 1)
      throw new BadRequestException(
        'Selecione uma única plataforma por operação',
      );
    return values[0] ?? null;
  };
  const current = normalize([
    ...(existing.plataformas ?? []),
    existing.platformTag,
    existing.tenantTag,
  ]);
  const provided =
    dto.plataformas !== undefined ||
    dto.platformTag !== undefined ||
    dto.tenantTag !== undefined;
  const supplied = normalize([
    ...(dto.plataformas ?? []),
    dto.platformTag,
    dto.tenantTag,
  ]);
  if (provided && supplied !== current)
    throw new BadRequestException(
      'Plataforma financeira não pode ser alterada na edição',
    );
}
