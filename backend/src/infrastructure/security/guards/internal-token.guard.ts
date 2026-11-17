import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/** Chamadas serviço-a-serviço: exige `x-internal-token` igual a `INTERNAL_SERVICE_TOKEN`. */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    const supplied = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>()
      .headers['x-internal-token'];
    if (
      !expected ||
      typeof supplied !== 'string' ||
      Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    )
      throw new UnauthorizedException('Token interno inválido');
    return true;
  }
}
