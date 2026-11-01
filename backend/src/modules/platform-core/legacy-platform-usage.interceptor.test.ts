import { expect, mock, test } from 'bun:test';
import { Logger } from '@nestjs/common';
import { of } from 'rxjs';
import {
  LEGACY_PLATFORM_CONTRACTS,
  RETIRED_LEGACY_PLATFORM_CONTRACTS,
} from './legacy-platform-contracts';
import { LegacyPlatformUsageInterceptor } from './legacy-platform-usage.interceptor';
test('all inventoried aliases log template only; canonical/unrelated paths are excluded', () => {
  const original = Logger.prototype.log;
  const log = mock(() => {});
  Logger.prototype.log = log;
  try {
    const interceptor = new LegacyPlatformUsageInterceptor();
    const request = (method: string, path: string) =>
      ({
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => ({
            method,
            route: { path },
            headers: { authorization: 'secret' },
            query: { token: 'secret' },
            body: { card: 'secret' },
          }),
        }),
      }) as any;
    for (const c of LEGACY_PLATFORM_CONTRACTS)
      interceptor.intercept(request(c.method, c.path), {
        handle: () => of(null),
      });
    expect(log).toHaveBeenCalledTimes(128);
    for (const [entry] of log.mock.calls as unknown as [
      Record<string, unknown>,
    ][])
      expect(Object.keys(entry).sort()).toEqual(['method', 'route']);
    interceptor.intercept(request('POST', '/platforms/:tag/payments'), {
      handle: () => of(null),
    });
    interceptor.intercept(request('GET', '/admin/users'), {
      handle: () => of(null),
    });
    for (const c of RETIRED_LEGACY_PLATFORM_CONTRACTS)
      interceptor.intercept(request(c.method, c.path), {
        handle: () => of(null),
      });
    expect(log).toHaveBeenCalledTimes(128);
  } finally {
    Logger.prototype.log = original;
  }
});
