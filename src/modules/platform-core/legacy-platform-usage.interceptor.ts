import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';

/** Records route template only: credentials, identifiers and query strings are never logged. */
@Injectable()
export class LegacyPlatformUsageInterceptor implements NestInterceptor {
  private readonly logger = new Logger('LegacyPlatformAlias');
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest();
      const template = request.route?.path;
      if (typeof template === 'string' && /^\/(atlas|bosque|renovada|revalida|zero-grau|return-bet|internal\/(ebook|atlas|bosque|renovada|pagatg|areaflix|betai|integrations))(\/|$)/.test(template)) {
        this.logger.log({ method: request.method, route: template });
      }
    }
    return next.handle();
  }
}
