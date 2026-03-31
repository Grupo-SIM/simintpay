import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { isMasterAdminUser } from '../../../shared/utils/is-master-admin.util';

@Injectable()
export class MasterAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { sub?: string } }>();
    const sub = req.user?.sub;
    if (!sub) {
      throw new ForbiddenException('Acesso negado');
    }
    const admin = await this.prisma.user.findUnique({
      where: { id: sub },
      include: { tenantModule: true },
    });
    if (!admin || !isMasterAdminUser(admin)) {
      throw new ForbiddenException('Somente admin master');
    }
    return true;
  }
}
