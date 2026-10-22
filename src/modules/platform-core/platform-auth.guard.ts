import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PlatformContextService } from './platform-context.service';

@Injectable()
export class PlatformAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly contexts: PlatformContextService, private readonly reflector: Reflector) { super(); }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request.headers.authorization) await super.canActivate(context);
    const operation = this.reflector.get<string>('platform-operation', context.getHandler());
    request.platformContext = await this.contexts.authorize(request.params.tag, operation, request.user, request.headers['x-access-token'], request.params.externalMerchantId);
    return true;
  }
}
