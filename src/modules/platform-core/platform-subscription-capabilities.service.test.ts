import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PlatformSubscriptionCapabilitiesService } from './platform-subscription-capabilities.service';
import type { PlatformContext } from './platform-context.service';

function fixture(tag = 'BETAI') {
  const context: PlatformContext = { id: 'platform', tag, ownerUserId: 'current-owner', acquirer: 'DOM' };
  const execute = mock(async (_input: unknown) => ({ data: { id: 'link', codigo: 'code', nome: 'Plan', valor: 12.34, ativo: true } }));
  const findFirst = mock(async (_query: unknown) => ({ id: 'link' } as { id: string } | null));
  const findOrder = mock(async (_query: unknown) => ({ createdAt: new Date('2026-01-01') }));
  const findAccess = mock(async (_query: unknown) => null);
  const prisma = { subscriptionLink: { findFirst }, subscriptionLinkOrder: { findFirst: findOrder }, platformSubscriberAccess: { findUnique: findAccess } };
  const resolve = mock(async () => ({ ...context }));
  const service = new PlatformSubscriptionCapabilitiesService(prisma as never, { resolve } as never, { get: () => ({ execute }) } as never);
  return { service, context, execute, findFirst, findOrder, findAccess, resolve };
}

describe('corporate subscription capabilities', () => {
  test('BetAI delegates plan creation to shared subscription use case using current owner and explicit platform', async () => {
    const f = fixture();
    const result = await f.service.createPlan(f.context, { name: 'Plan', amountCents: 1234, frequency: 'MENSAL', userId: 'attacker', email: 'attacker@example.com' } as never);
    expect(f.execute).toHaveBeenCalledWith({ userId: 'current-owner', role: 'USER', dto: { nome: 'Plan', descricao: undefined, valor: 12.34, frequencia: 'MENSAL', isStandalone: true, paymentMethods: 'BOTH', platformTag: 'BETAI', plataformas: ['BETAI'] } });
    expect(result.amountCents).toBe(1234);
    expect(result).not.toHaveProperty('valor');
  });
  test('Pagatg uses same shared plan operation', async () => {
    const f = fixture('PAGATG');
    await f.service.createPlan(f.context, { name: 'Plan', amountCents: 100, frequency: 'ANUAL' });
    expect(f.execute.mock.calls[0][0]).toMatchObject({ dto: { platformTag: 'PAGATG', valor: 1 } });
  });
  test('unsupported platform and acquirer reject before calling gateway use case', async () => {
    const f = fixture('OTHER');
    await expect(f.service.createPlan(f.context, { name: 'Plan', amountCents: 100, frequency: 'MENSAL' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(f.execute).not.toHaveBeenCalled();
    f.context.tag = 'BETAI'; f.context.acquirer = 'FRENDZ';
    await expect(f.service.createPlan(f.context, { name: 'Plan', amountCents: 100, frequency: 'MENSAL' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(f.execute).not.toHaveBeenCalled();
  });
  test('owner transfer invalidates stale authenticated write context', async () => {
    const f = fixture();
    f.resolve.mockResolvedValueOnce({ ...f.context, ownerUserId: 'new-owner' });
    await expect(f.service.createPlan(f.context, { name: 'Plan', amountCents: 100, frequency: 'MENSAL' })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.execute).not.toHaveBeenCalled();
  });
  test('status requires matching current owner and platform even when owner is shared', async () => {
    const f = fixture();
    await f.service.paymentStatus(f.context, 'code');
    expect(f.findFirst).toHaveBeenCalledWith({ where: { code: 'code', userId: 'current-owner', OR: [{ platformTag: 'BETAI' }, { plataformas: { has: 'BETAI' } }] }, select: { id: true } });
    f.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.paymentStatus(f.context, 'other-platform')).rejects.toBeInstanceOf(NotFoundException);
    expect(f.findOrder).toHaveBeenCalledTimes(1);
  });
  test('SaaS access lookup preserves platform separation and normalizes email', async () => {
    const f = fixture('CONTROLE-MOTORISTA');
    expect(await f.service.access(f.context, ' Customer@Example.com ')).toEqual({ exists: false, access: null });
    expect(f.findAccess).toHaveBeenCalledWith({ where: { platformTag_customerEmail: { platformTag: 'CONTROLE-MOTORISTA', customerEmail: 'customer@example.com' } }, select: { isActive: true, expiresAt: true, frozenDays: true, totalDaysCredited: true, lastPaymentMethod: true } });
    const other = fixture('BETAI');
    await expect(other.service.access(other.context, 'customer@example.com')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(other.findAccess).not.toHaveBeenCalled();
  });
});
