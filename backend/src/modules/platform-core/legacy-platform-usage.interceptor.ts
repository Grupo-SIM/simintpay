import { LEGACY_PLATFORM_CONTRACTS } from './legacy-platform-contracts';
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';

/** Records route template only: credentials, identifiers and query strings are never logged. */
@Injectable()
export class LegacyPlatformUsageInterceptor implements NestInterceptor {
  private readonly logger = new Logger('LegacyPlatformAlias');
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest();
      const template = request.route?.path;
      if (typeof template === 'string' && LEGACY_PLATFORM_CONTRACTS.some(contract => contract.method === request.method && contract.path === template)) {
        this.logger.log({ method: request.method, route: template });
      }
    }
    return next.handle();
  }
}
