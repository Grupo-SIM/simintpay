import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

/** Shared SaaS subscriber projection and freeze/resume operation. */
export class PlatformSaasAccessService {
  constructor(private readonly prisma: PrismaService) {}
  private async ensureActive(tag: string) {
    const platform = await this.prisma.platform.findUnique({
      where: { tag },
      include: { owner: true },
    });
    if (
      !platform?.isActive ||
      !platform.owner.isActive ||
      platform.owner.isPurged
    )
      throw new ForbiddenException('Plataforma ou dono inativo');
  }
  private getSaasBaseUrl(tag: string): string | null {
    const upper = tag.toUpperCase();
    if (upper === 'CONTROLE-PATRIMONIAL')
      return String(
        getPlatformIntegrationValue('CONTROLE-PATRIMONIAL', 'BACKEND_URL') ??
          '',
      ).replace(/\/+$/, '');
    if (upper === 'CONTROLE-MOTORISTA')
      return String(
        getPlatformIntegrationValue('CONTROLE-MOTORISTA', 'BACKEND_URL') ?? '',
      ).replace(/\/+$/, '');
    return null;
  }
  private calcRemainingDays(
    expiresAt: Date,
    frozenDays: number,
    isActive: boolean,
  ): number {
    if (!isActive) return frozenDays;
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
  async list(tag: string, status = 'all', page = '1', limit = '20') {
    const upper = tag.toUpperCase();
    const validTags = ['CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL'];
    if (!validTags.includes(upper))
      throw new NotFoundException(
        `Plataforma ${tag} não suporta listagem de usuários`,
      );

    await this.ensureActive(upper);
    const pageNum = Math.max(1, Number(page));
    const pageSize = Math.min(Math.max(1, Number(limit)), 100);

    const where: any = { platformTag: upper };
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;

    const [records, total] = await Promise.all([
      this.prisma.platformSubscriberAccess.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.platformSubscriberAccess.count({ where }),
    ]);

    const users = records.map((r) => ({
      id: r.id,
      email: r.customerEmail,
      name: r.customerName,
      cpf: r.customerCpf,
      phone: r.customerPhone,
      isActive: r.isActive,
      expiresAt: r.expiresAt,
      remainingDays: this.calcRemainingDays(
        r.expiresAt,
        r.frozenDays,
        r.isActive,
      ),
      frozenDays: r.frozenDays,
      totalDaysCredited: r.totalDaysCredited,
      lastPaymentMethod: r.lastPaymentMethod ?? null,
      createdAt: r.createdAt,
    }));

    return {
      users,
      total,
      page: pageNum,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
  async toggle(tag: string, userId: string) {
    const upper = tag.toUpperCase();
    const validTags = ['CONTROLE-MOTORISTA', 'CONTROLE-PATRIMONIAL'];
    if (!validTags.includes(upper))
      throw new NotFoundException(
        `Plataforma ${tag} não suporta toggle de usuários`,
      );

    await this.ensureActive(upper);
    const record = await this.prisma.platformSubscriberAccess.findUnique({
      where: { id: userId },
    });
    if (!record || record.platformTag !== upper)
      throw new NotFoundException('Assinante não encontrado');

    const now = new Date();
    let updated: any;

    if (record.isActive) {
      // ── PAUSAR: congelar os dias restantes ───────────────────────────────────
      const remainingDays = this.calcRemainingDays(
        record.expiresAt,
        record.frozenDays,
        true,
      );
      updated = await this.prisma.platformSubscriberAccess.updateMany({
        where: {
          id: userId,
          platformTag: upper,
          isActive: record.isActive,
          expiresAt: record.expiresAt,
          frozenDays: record.frozenDays,
        },
        data: { isActive: false, expiresAt: now, frozenDays: remainingDays },
      });
    } else {
      // ── RETOMAR: devolver os dias congelados ─────────────────────────────────
      const daysToReturn = record.frozenDays;
      if (daysToReturn <= 0)
        throw new Error('Não há dias guardados para retomar');
      const newExpiry = new Date(
        now.getTime() + daysToReturn * 24 * 60 * 60 * 1000,
      );
      updated = await this.prisma.platformSubscriberAccess.updateMany({
        where: {
          id: userId,
          platformTag: upper,
          isActive: record.isActive,
          expiresAt: record.expiresAt,
          frozenDays: record.frozenDays,
        },
        data: { isActive: true, expiresAt: newExpiry, frozenDays: 0 },
      });
    }

    if (updated.count !== 1)
      throw new ConflictException('Acesso alterado por outra operação');
    updated = await this.prisma.platformSubscriberAccess.findUnique({
      where: { id: userId },
    });

    // Notifica o SaaS backend para sincronizar isActive do usuário
    const baseUrl = this.getSaasBaseUrl(upper);
    const token =
      getPlatformIntegrationValue(upper, 'INTERNAL_TOKEN') ||
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      '';
    if (baseUrl && token) {
      fetch(`${baseUrl}/internal/users/toggle-by-email`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          email: record.customerEmail,
          isActive: updated.isActive,
        }),
      }).catch(() => {
        /* não bloquear se o SaaS backend estiver indisponível */
      });
    }

    return {
      toggled: true,
      isActive: updated.isActive,
      remainingDays: this.calcRemainingDays(
        updated.expiresAt,
        updated.frozenDays,
        updated.isActive,
      ),
      frozenDays: updated.frozenDays,
      expiresAt: updated.expiresAt,
    };
  }
}
