import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';

@Injectable()
export class ReportSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    if (user && user.authMode !== 'integration' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Consulte os relatórios da sua conta em /relatorios');
    }
    return true;
  }
}
