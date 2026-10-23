import { expect, test } from 'bun:test';
import { CoproductionSessionGuard } from './coproduction-session.guard';
test('interactive coproduction denies service credentials even when impersonating an existing user', () => {
 const guard = new CoproductionSessionGuard();
 const ctx = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
 expect(() => guard.canActivate(ctx({ sub: 'admin', authMode: 'integration' }))).toThrow('sessão');
 expect(() => guard.canActivate(ctx(undefined))).toThrow('sessão');
 expect(guard.canActivate(ctx({ sub: 'owner' }))).toBe(true);
});
