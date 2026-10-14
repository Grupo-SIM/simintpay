import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

/** Only inventoried internal aliases use this guard. Canonical APIs never inherit it. */
@Injectable()
export class LegacyInternalAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    if (this.reflector.get<boolean>('legacy-public', context.getHandler())) return true;
    const tag = this.reflector.get<string>('legacy-platform-tag', context.getClass());
    const expected = tag && ['EBOOK', 'BOSQUE', 'AREAFLIX'].includes(tag)
      ? getPlatformIntegrationValue(tag, 'INTERNAL_TOKEN')
      : process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    const token = context.switchToHttp().getRequest().headers?.['x-internal-token'];
    if (!expected || typeof token !== 'string' || token !== expected) throw new UnauthorizedException('Token interno inválido');
    return true;
  }
}
