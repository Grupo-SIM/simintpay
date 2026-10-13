import { initializePlatformIntegrationsCache, invalidatePlatformIntegrationsCache } from '../../modules/platform-integrations/platform-integrations.store';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { canonicalPlatformTaxaTag, initializePlatformTaxasCache } from '../../modules/platform-taxas/platform-taxas.store';
import { initializePlatformRegistryCache, setCustomerInterestRates } from '../../modules/module.registry';

import type { PaymentLink } from '@prisma/client';
import { calculatePaymentLinkFees } from '../use-cases/payment-link/payment-link-fees.helper';

const publicSelect = {
  id: true, tag: true, name: true, ownerUserId: true, isActive: true, acquirer: true,
  customerInterestRates: true, absorbCustomerInterest: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireSession(user: JwtPayload) {
    if (!user || user.authMode === 'integration') throw new ForbiddenException('Exige sessão de usuário');
    const actor = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!actor?.isActive || actor.isPurged) throw new ForbiddenException('Conta inativa');
    return { ...user, role: actor.role };
  }

  async list(user: JwtPayload) {
    user = await this.requireSession(user);
    return { data: await this.prisma.platform.findMany({
      where: user.role === Role.ADMIN ? {} : { ownerUserId: user.sub },
      select: publicSelect, orderBy: { tag: 'asc' },
    }) };
  }

  async requireAccess(tag: string, user: JwtPayload) {
    user = await this.requireSession(user);
    const platform = await this.prisma.platform.findUnique({ where: { tag: canonicalPlatformTaxaTag(tag) } });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (user.role !== Role.ADMIN && platform.ownerUserId !== user.sub) throw new ForbiddenException('Plataforma pertence a outro usuário');
    return platform;
  }

  async create(user: JwtPayload, body: { tag?: string; name?: string; ownerUserId?: string }) {
    user = await this.requireSession(user);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Body inválido');
    const tag = canonicalPlatformTaxaTag(typeof body.tag === 'string' ? body.tag.trim() : '');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!/^[A-Z][A-Z0-9-]{1,49}$/.test(tag) || ['GLOBAL', 'SIMINTPAY'].includes(tag)) throw new BadRequestException('Tag inválida ou reservada');
    if (!name) throw new BadRequestException('Nome obrigatório');
    if (user.role !== Role.ADMIN && body.ownerUserId && body.ownerUserId !== user.sub) throw new ForbiddenException('Somente administrador pode atribuir outro dono');
    const ownerUserId = body.ownerUserId ?? user.sub;
    if (!await this.prisma.user.findFirst({ where: { id: ownerUserId, isActive: true, isPurged: false } })) throw new BadRequestException('Dono não encontrado ou inativo');
    try {
      const platform = await this.prisma.$transaction(async (tx) => {
        const module = await tx.tenantModule.upsert({ where: { slug: tag.toLowerCase() }, update: {}, create: { slug: tag.toLowerCase(), name } });
        return tx.platform.create({ data: { tag, name, ownerUserId, tenantModuleId: module.id }, select: publicSelect });
      });
      await initializePlatformRegistryCache(this.prisma);
      return { data: platform };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Plataforma já cadastrada');
      throw error;
    }
  }

  async update(tag: string, user: JwtPayload, body: { name?: string; isActive?: boolean; ownerUserId?: string; acquirer?: 'DOM' | 'FRENDZ'; absorbCustomerInterest?: boolean }) {
    user = await this.requireSession(user);
    const platform = await this.requireAccess(tag, user);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Body inválido');
    if (body.ownerUserId !== undefined && user.role !== Role.ADMIN) throw new ForbiddenException('Somente administrador pode transferir plataforma');
    if (body.ownerUserId !== undefined && !await this.prisma.user.findFirst({ where: { id: body.ownerUserId, isActive: true, isPurged: false } })) throw new BadRequestException('Dono não encontrado ou inativo');
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) throw new BadRequestException('Nome obrigatório');
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw new BadRequestException('Estado inválido');
    if (body.absorbCustomerInterest !== undefined && typeof body.absorbCustomerInterest !== 'boolean') throw new BadRequestException('Opção de absorção inválida');
    if (body.acquirer !== undefined && !['DOM', 'FRENDZ'].includes(body.acquirer)) throw new BadRequestException('Adquirente inválida');
    const updated = await this.prisma.platform.update({ where: { id: platform.id }, data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
      ...(body.absorbCustomerInterest !== undefined ? { absorbCustomerInterest: body.absorbCustomerInterest } : {}),
      ...(body.acquirer !== undefined ? { acquirer: body.acquirer } : {}),
    }, select: publicSelect });
    await initializePlatformRegistryCache(this.prisma);
    invalidatePlatformIntegrationsCache();
    await initializePlatformIntegrationsCache(this.prisma);
    return { data: updated };
  }
  async patchCustomerInterestRates(tag: string, user: JwtPayload, body: { rates?: Record<string, unknown> }) {
    user = await this.requireSession(user);
    const platform = await this.requireAccess(tag, user);
    if (!body || !body.rates || typeof body.rates !== 'object' || Array.isArray(body.rates)) throw new BadRequestException('Tabela de juros inválida');
    const rates: Record<string, number> = { ...(platform.customerInterestRates as Record<string, number>) };
    if (Object.keys(body.rates).length === 0) throw new BadRequestException('Informe ao menos uma parcela');
    for (const [key, value] of Object.entries(body.rates)) {
      if (!/^(?:[1-9]|1[0-2])$/.test(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new BadRequestException('Parcelas devem ser 1 a 12 e juros decimais entre 0 e 1');
      }
      rates[key] = value;
    }
    const updated = await this.prisma.platform.update({ where: { id: platform.id }, data: { customerInterestRates: rates }, select: publicSelect });
    setCustomerInterestRates(platform.tag, rates);
    await initializePlatformTaxasCache(this.prisma);
    return { data: updated, meta: { warnings: this.simulation(platform.tag, 100).filter((row) => row.negativeMargin) } };
  }

  async simulate(tag: string, user: JwtPayload, amount: unknown) {
    user = await this.requireSession(user);
    const platform = await this.requireAccess(tag, user);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException('Valor deve ser positivo');
    return { data: this.simulation(platform.tag, value) };
  }

  private simulation(tag: string, amount: number) {
    const link = { amount, isStandalone: false } as unknown as PaymentLink;
    return Array.from({ length: 12 }, (_, i) => ({ installments: i + 1, ...calculatePaymentLinkFees(link, i + 1, tag) }));
  }

}
