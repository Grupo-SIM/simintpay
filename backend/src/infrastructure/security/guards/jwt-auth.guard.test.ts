import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UnauthorizedException } from '@nestjs/common';
const parent = Object.getPrototypeOf(JwtAuthGuard.prototype);
let fallback: ReturnType<typeof spyOn> | undefined;
afterEach(() => { fallback?.mockRestore(); });
function fixture(credential: unknown = null, path = '/links-pagamento') {
  fallback = spyOn(parent, 'canActivate').mockRejectedValue(new UnauthorizedException());
  const create = mock(async () => ({}));
  const findUnique = mock(async () => credential);
  const guard = new JwtAuthGuard({ platformIntegration: { findUnique }, user: { create } } as never);
  const request: { headers: Record<string, string>; url: string; method: string; user?: Record<string, unknown> } = { headers: { 'x-access-token': 'registered-test-token' }, url: path, method: 'POST' };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;
  return { guard, request, context, create, findUnique };
}
describe('explicit integration authentication', () => {
  test('unknown token fails without creating account', async () => {
    const f = fixture();
    await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.create).not.toHaveBeenCalled();
  });
  test('assigned token uses owner with integration scope and no admin privilege', async () => {
    const f = fixture({ key: 'INBOUND_TOKEN', platform: { id: 'shop', tag: 'SHOP', ownerUserId: 'owner', isActive: true, owner: { email: 'owner@example.com', isActive: true, isPurged: false, role: 'ADMIN' } } });
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.request.user).toMatchObject({ sub: 'owner', role: 'USER', platformId: 'shop', authMode: 'integration' });
    expect(f.create).not.toHaveBeenCalled();
  });
  test('token cannot access admin APIs', async () => {
    const f = fixture({}, '/admin/plataformas');
    await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.findUnique).not.toHaveBeenCalled();
  });
  test('inactive owner cannot authenticate', async () => {
    const f = fixture({ key: 'INBOUND_TOKEN', platform: { isActive: true, owner: { isActive: false } } });
    await expect(f.guard.canActivate(f.context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
