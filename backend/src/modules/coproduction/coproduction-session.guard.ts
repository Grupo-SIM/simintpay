import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
@Injectable()
export class CoproductionSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<{ user?: { authMode?: string } }>().user;
    if (!user || user.authMode === 'integration') throw new ForbiddenException('Co-produção exige sessão de usuário');
    return true;
  }
}
