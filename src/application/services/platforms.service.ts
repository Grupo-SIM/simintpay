import { loadFinancialPolicy } from '../../modules/financial-policy/financial-policy.service';
import { getFinancialPolicy, saveFinancialPolicy, simulateFinancialPolicy, type SimulationInput } from '../../modules/financial-policy/financial-policy.service';
import { CORPORATE_PLATFORM_TAGS } from '../../modules/platform-core/platform-adapters';
import { initializePlatformIntegrationsCache, invalidatePlatformIntegrationsCache } from '../../modules/platform-integrations/platform-integrations.store';
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { canonicalPlatformTaxaTag, initializePlatformTaxasCache, getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import { initializePlatformRegistryCache, setCustomerInterestRates } from '../../modules/module.registry';

import { PLATFORM_TAXA_DEFAULTS, type PlataformaTaxaKey } from '../../modules/platform-taxas/platform-taxas.keys';
import type { PaymentLink } from '@prisma/client';
import { calculatePaymentLinkFees } from '../use-cases/payment-link/payment-link-fees.helper';

const publicSelect = {
  id: true, tag: true, name: true, ownerUserId: true, isActive: true, acquirer: true,
  customerInterestRates: true, absorbCustomerInterest: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  financialPolicy(tag: string, user: JwtPayload) { return getFinancialPolicy(this.prisma, canonicalPlatformTaxaTag(tag), user); }
  saveFinancialPolicy(tag: string, user: JwtPayload, body: unknown) { return saveFinancialPolicy(this.prisma, canonicalPlatformTaxaTag(tag), user, body); }
  simulateFinancialPolicy(tag: string, user: JwtPayload, body: SimulationInput) { return simulateFinancialPolicy(this.prisma, canonicalPlatformTaxaTag(tag), user, body); }

  private async assertLegacyPolicy(tag: string) {
    const policy = await loadFinancialPolicy(this.prisma, tag);
    if (Object.values(policy.document.lanes).some(lane => lane.active)) throw new GoneException('Use a configuração e simulação em /financial-policy');
  }

  private async requireSession(user: JwtPayload) {
    if (!user || user.authMode === 'integration') throw new ForbiddenException('Exige sessão de usuário');
    const actor = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!actor?.isActive || actor.isPurged) throw new ForbiddenException('Conta inativa');
    return { ...user, role: actor.role };
  }

  async integrationDiagnostics(user: JwtPayload) {
    user = await this.requireSession(user);
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Exige administrador');
    const rows = await this.prisma.platform.findMany({ include: { owner: { select: { isActive: true, isPurged: true } }, integrations: { select: { key: true, tokenHash: true, url: true, encryptedValue: true } } }, orderBy: { tag: 'asc' } });
    return { data: rows.map(platform => ({
      id: platform.id, tag: platform.tag, ownerUserId: platform.ownerUserId,
      active: platform.isActive && platform.owner.isActive && !platform.owner.isPurged,
      inboundCredentialLinked: platform.integrations.some(row => row.key === 'INBOUND_TOKEN' && !!row.tokenHash && !!row.encryptedValue),
      operations: platform.integrations.find(row => row.key === 'INBOUND_OPERATIONS')?.url?.split(',').map(scope => scope.trim()) ?? ['payments:create'],
      communityLinked: platform.tag === 'RETURN-BET' ? platform.integrations.some(row => row.key === 'COMMUNITY_PLATFORM_TAG' && !!row.url) : undefined,
    })) };
  }

  async list(user: JwtPayload, ownedOnly = false) {
    user = await this.requireSession(user);
    const platforms = await this.prisma.platform.findMany({
      where: !ownedOnly && user.role === Role.ADMIN ? {} : { ownerUserId: user.sub },
      select: publicSelect, orderBy: { tag: 'asc' },
    });
    return { data: platforms.map(platform => ({ ...platform, effectiveCustomerInterestRates: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), platform.absorbCustomerInterest ? 0 : (platform.customerInterestRates as Record<string, number> | null)?.[String(i + 1)] ?? getPlatformTaxaEffective('GLOBAL', `MDR_LINK_${i + 1}X`, PLATFORM_TAXA_DEFAULTS[`MDR_LINK_${i + 1}X` as PlataformaTaxaKey])])) })) };
  }

  async acquirers(user: JwtPayload) {
    await this.requireSession(user);
    return { data: await this.prisma.acquirerCatalogue.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true } }) };
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
    if (CORPORATE_PLATFORM_TAGS.has(tag) && user.role !== Role.ADMIN) throw new ForbiddenException('Tag corporativa reservada ao administrador');
    if (!name) throw new BadRequestException('Nome obrigatório');
    if (user.role !== Role.ADMIN && body.ownerUserId && body.ownerUserId !== user.sub) throw new ForbiddenException('Somente administrador pode atribuir outro dono');
    const ownerUserId = body.ownerUserId ?? user.sub;
    if (!await this.prisma.user.findFirst({ where: { id: ownerUserId, isActive: true, isPurged: false } })) throw new BadRequestException('Dono não encontrado ou inativo');
    try {
      const platform = await this.prisma.platform.create({ data: { tag, name, ownerUserId, absorbCustomerInterest: true }, select: publicSelect });
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
    if (body.absorbCustomerInterest !== undefined) await this.assertLegacyPolicy(platform.tag);
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
  async patchCustomerInterestRates(tag: string, user: JwtPayload, body: { rates?: Record<string, unknown>; absorbCustomerInterest?: boolean }) {
    user = await this.requireSession(user);
    const platform = await this.requireAccess(tag, user);
    if (!body || (body.rates !== undefined && (!body.rates || typeof body.rates !== 'object' || Array.isArray(body.rates)))) throw new BadRequestException('Tabela de juros inválida');
    if (body.absorbCustomerInterest !== undefined && typeof body.absorbCustomerInterest !== 'boolean') throw new BadRequestException('Opção de absorção inválida');
    if (body.absorbCustomerInterest !== undefined) await this.assertLegacyPolicy(platform.tag);
    await this.assertLegacyPolicy(platform.tag);
    const rates: Record<string, number> = { ...(platform.customerInterestRates as Record<string, number>) };
    if (Object.keys(body.rates ?? {}).length === 0 && body.absorbCustomerInterest === undefined) throw new BadRequestException('Informe ao menos uma parcela ou opção de absorção');
    for (const [key, value] of Object.entries(body.rates ?? {})) {
      if (!/^(?:[1-9]|1[0-2])$/.test(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new BadRequestException('Parcelas devem ser 1 a 12 e juros decimais entre 0 e 1');
      }
      rates[key] = value;
    }
    const updated = await this.prisma.platform.update({ where: { id: platform.id }, data: { customerInterestRates: rates, ...(body.absorbCustomerInterest !== undefined ? { absorbCustomerInterest: body.absorbCustomerInterest } : {}) }, select: publicSelect });
    setCustomerInterestRates(platform.tag, rates);
    await initializePlatformRegistryCache(this.prisma);
    await initializePlatformTaxasCache(this.prisma);
    return { data: updated, meta: { warnings: this.simulation(platform.tag, 100).filter((row) => row.negativeMargin).map(row => this.projectLegacySimulation(row, user.role === Role.ADMIN)) } };
  }

  async simulate(tag: string, user: JwtPayload, amount: unknown) {
    user = await this.requireSession(user);
    const platform = await this.requireAccess(tag, user);
    await this.assertLegacyPolicy(platform.tag);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException('Valor deve ser positivo');
    return { data: this.simulation(platform.tag, value).map(row => this.projectLegacySimulation(row, user.role === Role.ADMIN)) };
  }

  async simulateDraft(tag: string, user: JwtPayload, body: { amount?: unknown; rates?: Record<string, unknown>; absorbCustomerInterest?: boolean }) {
    user = await this.requireSession(user);
    const platform = await this.requireAccess(tag, user);
    await this.assertLegacyPolicy(platform.tag);
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor deve ser positivo');
    if (body.absorbCustomerInterest !== undefined && typeof body.absorbCustomerInterest !== 'boolean') throw new BadRequestException('Opção de absorção inválida');
    if (body.absorbCustomerInterest !== undefined) await this.assertLegacyPolicy(platform.tag);
    if (body.rates !== undefined && (!body.rates || typeof body.rates !== 'object' || Array.isArray(body.rates))) throw new BadRequestException('Tabela de juros inválida');
    for (const [key, value] of Object.entries(body.rates ?? {})) {
      if (!/^(?:[1-9]|1[0-2])$/.test(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new BadRequestException('Parcelas devem ser 1 a 12 e juros decimais entre 0 e 1');
    }
    const link = { amount, isStandalone: false } as unknown as PaymentLink;
    return { data: Array.from({ length: 12 }, (_, index) => {
      const installments = index + 1;
      const rate = body.rates?.[String(installments)] as number | undefined;
      return this.projectLegacySimulation({ installments, ...calculatePaymentLinkFees(link, installments, platform.tag, false, body.absorbCustomerInterest ?? platform.absorbCustomerInterest, rate, body.absorbCustomerInterest) }, user.role === Role.ADMIN);
    }) };
  }

  private projectLegacySimulation<T extends { domFeeAmount: number; sellerFee: number }>(row: T, admin: boolean) {
    if (admin) return row;
    const { domFeeAmount, domFeeRate: _rate, domFixedFee: _fixed, ...visible } = row as T & { domFeeRate?: number; domFixedFee?: number };
    return { ...visible, sellerFee: row.sellerFee + domFeeAmount };
  }

  private simulation(tag: string, amount: number) {
    const link = { amount, isStandalone: false } as unknown as PaymentLink;
    return Array.from({ length: 12 }, (_, i) => ({ installments: i + 1, ...calculatePaymentLinkFees(link, i + 1, tag) }));
  }

}
