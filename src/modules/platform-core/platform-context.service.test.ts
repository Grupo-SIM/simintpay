import { describe, it, expect, mock } from 'bun:test';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hashPlatformToken } from '../platform-integrations/platform-secrets';
import { PlatformContextService } from './platform-context.service';

const actor = { sub: 'owner-a', email: 'owner@example.com', role: 'USER' };

function fixture() {
  const platform = { id: 'platform-a', tag: 'CLIENT-A', ownerUserId: 'owner-a', acquirer: 'DOM', isActive: true,
    owner: { id: 'owner-a', isActive: true, isPurged: false } };
  const credential = { key: 'INBOUND_TOKEN', platformId: platform.id };
  let scope: string | undefined;
  const prisma = {
    platform: { findUnique: mock(async () => platform) },
    user: { findUnique: mock(async () => ({ id: 'owner-a', role: 'USER', isActive: true, isPurged: false })) },
    platformIntegration: { findUnique: mock(async (query: { where: { tokenHash?: string } }) => query.where.tokenHash ? credential : scope === undefined ? null : { url: scope }) },
  };
  return { service: new PlatformContextService(prisma as never), prisma, platform, credential,
    setScope(value: string | undefined) { scope = value; } };
}

describe('PlatformContextService', () => {
  it('resolves registered generic platform and active current owner from database', async () => {
    const { service, prisma } = fixture();
    await expect(service.resolve('client-a')).resolves.toEqual({ id: 'platform-a', tag: 'CLIENT-A', ownerUserId: 'owner-a', acquirer: 'DOM' });
    expect(prisma.platform.findUnique).toHaveBeenCalledWith({ where: { tag: 'CLIENT-A' }, include: { owner: true } });
  });

  it('rejects missing platform before consulting credentials', async () => {
    const { service, prisma } = fixture();
    prisma.platform.findUnique.mockResolvedValueOnce(null as never);
    await expect(service.authorize('unknown', 'payments:create', undefined, 'secret')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.platformIntegration.findUnique).not.toHaveBeenCalled();
  });

  it.each(['platform', 'owner', 'purged-owner'])('blocks %s inactivity before accepting credential', async (kind) => {
    const { service, platform, prisma } = fixture();
    if (kind === 'platform') platform.isActive = false;
    else if (kind === 'owner') platform.owner.isActive = false;
    else platform.owner.isPurged = true;
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.platformIntegration.findUnique).not.toHaveBeenCalled();
  });

  it('authorizes current owner without accepting body-supplied identity', async () => {
    const { service } = fixture();
    await expect(service.authorize('client-a', 'finance:read', actor)).resolves.toHaveProperty('ownerUserId', 'owner-a');
  });

  it('denies another platform owner', async () => {
    const { service, prisma } = fixture();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'owner-b', role: 'USER', isActive: true, isPurged: false });
    await expect(service.authorize('client-a', 'finance:read', { ...actor, sub: 'owner-b' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['inactive', 'purged', 'missing'])('rejects %s JWT actor', async (kind) => {
    const { service, prisma } = fixture();
    prisma.user.findUnique.mockResolvedValueOnce(kind === 'missing' ? null as never : { id: actor.sub, role: 'USER', isActive: kind !== 'inactive', isPurged: kind === 'purged' });
    await expect(service.authorize('client-a', 'payments:create', actor)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires credentials; integration JWT alone cannot authorize', async () => {
    const { service, prisma } = fixture();
    await expect(service.authorize('client-a', 'payments:create')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.authorize('client-a', 'payments:create', { ...actor, authMode: 'integration' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('looks up token hash and defaults credential to payment creation only', async () => {
    const { service, prisma } = fixture();
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).resolves.toHaveProperty('id', 'platform-a');
    expect(prisma.platformIntegration.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashPlatformToken('secret') } });
    await expect(service.authorize('client-a', 'finance:read', undefined, 'secret')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['wrong-platform', 'wrong-key', 'missing'])('rejects %s credential', async (kind) => {
    const { service, credential, prisma } = fixture();
    if (kind === 'wrong-platform') credential.platformId = 'platform-b';
    else if (kind === 'wrong-key') credential.key = 'INTERNAL_TOKEN';
    else prisma.platformIntegration.findUnique.mockResolvedValueOnce(null as never);
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires exact explicit operation scope, tolerating surrounding whitespace', async () => {
    const { service, setScope } = fixture();
    setScope('payments:read, finance:read , events:read');
    await expect(service.authorize('client-a', 'finance:read', undefined, 'secret')).resolves.toHaveProperty('tag', 'CLIENT-A');
    await expect(service.authorize('client-a', 'finance:write', undefined, 'secret')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).rejects.toBeInstanceOf(ForbiddenException);
    setScope('');
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('credential follows current owner after transfer without reissuing token', async () => {
    const { service, platform } = fixture();
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).resolves.toHaveProperty('ownerUserId', 'owner-a');
    platform.ownerUserId = 'owner-b';
    platform.owner.id = 'owner-b';
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).resolves.toHaveProperty('ownerUserId', 'owner-b');
    await expect(service.authorize('client-a', 'payments:create', actor)).rejects.toBeInstanceOf(ForbiddenException);
    platform.owner.isActive = false;
    await expect(service.authorize('client-a', 'payments:create', undefined, 'secret')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maintenance requires active admin and cannot be granted by token scopes', async () => {
    const { service, prisma, setScope } = fixture();
    await expect(service.authorize('client-a', 'maintenance:write', actor)).rejects.toBeInstanceOf(ForbiddenException);
    setScope('maintenance:write');
    await expect(service.authorize('client-a', 'maintenance:write', undefined, 'secret')).rejects.toBeInstanceOf(UnauthorizedException);
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'admin', role: 'ADMIN', isActive: true, isPurged: false });
    await expect(service.authorize('client-a', 'maintenance:write', { ...actor, sub: 'admin', role: 'ADMIN' })).resolves.toHaveProperty('id', 'platform-a');
  });
});

it('wallet import requires admin JWT or explicit integration scope', async () => {
  const { service, prisma, setScope } = fixture();
  await expect(service.authorize('client-a', 'ledger:write', actor)).rejects.toBeInstanceOf(ForbiddenException);
  setScope('ledger:write');
  await expect(service.authorize('client-a', 'ledger:write', undefined, 'secret')).resolves.toHaveProperty('id', 'platform-a');
  prisma.user.findUnique.mockResolvedValueOnce({ id: 'admin', role: 'ADMIN', isActive: true, isPurged: false });
  await expect(service.authorize('client-a', 'ledger:write', { ...actor, sub: 'admin' })).resolves.toHaveProperty('id', 'platform-a');
});
