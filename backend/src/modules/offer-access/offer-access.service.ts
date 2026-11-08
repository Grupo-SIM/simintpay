import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ChargeStatus, type OfferAccess } from '@prisma/client';
import { accessDaysForOffer } from '../../application/helpers/billing-frequency.helper';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  onChargeSettled,
  type ChargeSettledEvent,
} from '../billing-core/charge-settlement';
import { OfferAccessEventsService } from './offer-access-events.service';
import {
  creditDays,
  isEffectivelyActive,
  remainingDaysOf,
  resumeAccess,
  suspendAccess,
  type AccessState,
} from './offer-access.math';
import { PagatgNotifier, type PagatgCreditStatus } from './pagatg-notifier';

export type CreditOutcome = 'credited' | 'duplicate' | 'skipped' | 'retry';

/** Tempo para o commit de quem liquidou aparecer; depois disso desiste e registra. */
const RETRY_DELAYS_MS = [250, 1_000, 4_000, 15_000];

const digits = (document: string) => document.replace(/[.-]/g, '');

export const creditEventKey = (chargeId: string) => `credit:${chargeId}`;

const stateOf = (a: OfferAccess): AccessState => ({
  isActive: a.isActive,
  expiresAt: a.expiresAt,
  frozenDays: a.frozenDays,
  totalDaysCredited: a.totalDaysCredited,
});

/**
 * Crédito de dias de acesso das ofertas com renovação (porte do plano PIX de crédito).
 * Uma Charge paga credita uma única vez: o evento `credit:<chargeId>` é gravado na mesma
 * transação que atualiza o acesso, e uma liquidação repetida cai no `duplicate`.
 */
@Injectable()
export class OfferAccessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferAccessService.name);
  private off: (() => void) | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pagatg: PagatgNotifier,
    private readonly events: OfferAccessEventsService,
  ) {}

  onModuleInit() {
    this.off = onChargeSettled((event) => {
      if (event.kind === 'PAID') this.schedule(event);
    });
  }

  onModuleDestroy() {
    this.off?.();
    for (const t of this.timers) clearTimeout(t);
  }

  /** Agenda o crédito para depois do commit de quem liquida (o ouvinte roda dentro dele). */
  schedule(event: ChargeSettledEvent, attempt = 0) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.creditForTransaction(event.transactionId)
        .then((outcome) => {
          if (outcome === 'retry' && attempt + 1 < RETRY_DELAYS_MS.length)
            this.schedule(event, attempt + 1);
          else if (outcome === 'retry')
            this.logger.warn(
              `[OfferAccess] Charge da tx ${event.transactionId} não ficou visível; crédito descartado`,
            );
        })
        .catch((err: unknown) =>
          this.logger.error(
            `[OfferAccess] Falha ao creditar (tx=${event.transactionId}): ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }, RETRY_DELAYS_MS[attempt]);
    timer.unref?.();
    this.timers.add(timer);
  }

  // ── Crédito ─────────────────────────────────────────────────────────────

  async creditForTransaction(
    transactionId: string,
    now = new Date(),
  ): Promise<CreditOutcome> {
    const charge = await this.prisma.charge.findUnique({
      where: { transactionId },
      include: { offer: true },
    });
    if (!charge) return 'retry';
    if (!charge.offerId || !charge.offer) return 'skipped';
    const days = accessDaysForOffer(charge.offer);
    if (!days) return 'skipped';
    if (charge.status !== ChargeStatus.PAID) return 'retry';
    const email = charge.customerEmail?.trim();
    const document = charge.customerDocument
      ? digits(charge.customerDocument)
      : '';
    if (!email || !document) {
      this.logger.warn(
        `[OfferAccess] Charge ${charge.id} sem e-mail/documento do comprador; sem crédito`,
      );
      return 'skipped';
    }
    const offer = charge.offer;

    // Customer do vendedor (mesma ligação que o plano PIX legado mantinha).
    let customer = await this.prisma.customer.findFirst({
      where: { userId: offer.ownerUserId, document },
    });
    if (!customer)
      customer = await this.prisma.customer
        .create({
          data: {
            userId: offer.ownerUserId,
            name: charge.customerName || 'Cliente',
            email,
            document,
            documentType: document.length > 11 ? 'CNPJ' : 'CPF',
          },
        })
        .catch(() =>
          this.prisma.customer.findFirstOrThrow({
            where: { userId: offer.ownerUserId, document },
          }),
        );
    const customerId = customer.id;

    const eventKey = creditEventKey(charge.id);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`offer-access:${offer.id}:${document}`}, 0))`;
        if (await tx.offerAccessEvent.findUnique({ where: { eventKey } }))
          return null;
        const current = await tx.offerAccess.findUnique({
          where: {
            offerId_customerDocument: {
              offerId: offer.id,
              customerDocument: document,
            },
          },
        });
        const next = creditDays(current ? stateOf(current) : null, days, now);
        const data = {
          customerId,
          customerEmail: email,
          customerName: charge.customerName ?? current?.customerName ?? null,
          ...next,
          lastChargeId: charge.id,
          lastTransactionId: transactionId,
        };
        const access = current
          ? await tx.offerAccess.update({ where: { id: current.id }, data })
          : await tx.offerAccess.create({
              data: {
                ...data,
                offerId: offer.id,
                ownerUserId: offer.ownerUserId,
                customerDocument: document,
              },
            });
        const event = await tx.offerAccessEvent.create({
          data: {
            accessId: access.id,
            eventKey,
            type: 'CREDIT',
            payload: {
              chargeId: charge.id,
              transactionId,
              days,
              expiresAt: next.expiresAt.toISOString(),
            },
          },
        });
        return { access, eventId: event.id };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (!result) return 'duplicate';

    this.events.emit({ transactionId, status: 'COMPLETED' });
    const notified = await this.notify(result.access, 'COMPLETED');
    await this.prisma.offerAccessEvent
      .update({
        where: { id: result.eventId },
        data: {
          deliveredAt: now,
          attempts: { increment: 1 },
          lastError: notified ? null : 'pagatg-not-notified',
        },
      })
      .catch(() => undefined);
    this.logger.log(
      `[OfferAccess] +${days} dias (oferta ${offer.id}, charge ${charge.id})`,
    );
    return 'credited';
  }

  /**
   * Rede de segurança: cobranças de ciclo liquidadas pelo reconciliador ou pelo cartão guardado
   * (`BillingCycleService.settle`) não passam por `markChargeSettled` e portanto não emitem o
   * evento de liquidação. Credita as pagas, de ofertas com renovação, que ainda não têm o evento
   * `credit:<id>` (idempotente), usando `paidAt` como instante do crédito.
   */
  async creditMissed(now = new Date(), lookbackDays = 14) {
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<
      { transactionId: string; paidAt: Date | null }[]
    >`SELECT c."transactionId", c."paidAt" FROM "Charge" c
      JOIN "Offer" o ON o."id" = c."offerId"
      WHERE c."status" = 'PAID' AND c."transactionId" IS NOT NULL
        AND o."renewalMode" <> 'NONE' AND o."intervalType" IS NOT NULL AND c."paidAt" >= ${since}
        AND NOT EXISTS (SELECT 1 FROM "OfferAccessEvent" e WHERE e."eventKey" = 'credit:' || c."id")`;
    let credited = 0;
    for (const row of rows) {
      try {
        const outcome = await this.creditForTransaction(
          row.transactionId,
          row.paidAt ?? now,
        );
        if (outcome === 'credited') credited++;
      } catch (error) {
        this.logger.error(
          `[OfferAccess] Falha no crédito atrasado (tx=${row.transactionId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { considered: rows.length, credited };
  }

  // ── Notificação PAGATG ──────────────────────────────────────────────────

  /** Código `PX-` ativo mais recente da oferta (o que o api-pagatg conhece). */
  async pixCodeFor(offerId: string): Promise<string | null> {
    const alias = await this.prisma.offerCodeAlias.findFirst({
      where: { offerId, kind: 'PX', isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return alias?.code ?? null;
  }

  /**
   * Só notifica ofertas de origem "plano PIX": as que têm alias `PX-` ou a marca de
   * compatibilidade em `metadata.pixPlan`. COMPLETED exige o alias (como no legado);
   * ACTIVE/SUSPENDED usam `STATUS_UPDATE` quando não houver. Nunca lança.
   */
  async notify(
    access: Pick<
      OfferAccess,
      'offerId' | 'customerEmail' | 'customerId' | 'ownerUserId'
    >,
    status: PagatgCreditStatus,
  ): Promise<boolean> {
    try {
      const [code, offer] = await Promise.all([
        this.pixCodeFor(access.offerId),
        this.prisma.offer.findUnique({
          where: { id: access.offerId },
          select: { metadata: true },
        }),
      ]);
      const meta = (offer?.metadata ?? {}) as Record<string, unknown>;
      if (!code && !meta.pixPlan) return false;
      if (status === 'COMPLETED' && !code) return false;
      return await this.pagatg.notify({
        code: code ?? 'STATUS_UPDATE',
        email: access.customerEmail,
        customerId: access.customerId,
        status,
        userId: access.ownerUserId,
      });
    } catch (error) {
      this.logger.error(
        `[OfferAccess] Falha ao notificar PAGATG (${status}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  // ── Expiração (decremento diário) ───────────────────────────────────────

  /** Expira o acesso vencido (idempotente) e avisa o PAGATG com SUSPENDED. */
  async expireIfDue(access: OfferAccess, now = new Date()): Promise<boolean> {
    if (!access.isActive || access.expiresAt.getTime() > now.getTime())
      return false;
    const changed = await this.prisma.offerAccess.updateMany({
      where: { id: access.id, isActive: true, expiresAt: { lte: now } },
      data: { isActive: false },
    });
    if (changed.count === 0) return false;
    await this.notify(access, 'SUSPENDED');
    return true;
  }

  /** Porte de `plan-access/decrement-all`: o vencimento é a fonte da verdade, não há deriva. */
  async decrementAll(now = new Date()) {
    const active = await this.prisma.offerAccess.findMany({
      where: { isActive: true },
    });
    const owners = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(active.map((a) => a.ownerUserId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(owners.map((o) => [o.id, o.name]));
    const results = {
      processed: 0,
      expired: 0,
      updated: 0,
      errors: 0,
      details: [] as Array<Record<string, unknown>>,
    };
    for (const access of active) {
      try {
        const beforeDays = remainingDaysOf(access.expiresAt, now);
        const expired = await this.expireIfDue(access, now);
        results.processed++;
        if (expired) results.expired++;
        results.details.push({
          id: access.id,
          customerDocument: access.customerDocument,
          customerEmail: access.customerEmail,
          userName: names.get(access.ownerUserId),
          beforeDays,
          afterDays: expired ? 0 : beforeDays,
          isActive: !expired,
          totalDaysCredited: access.totalDaysCredited,
        });
      } catch {
        results.errors++;
      }
    }
    return results;
  }

  // ── Consulta ────────────────────────────────────────────────────────────

  async getPlanAccess(
    ownerUserId: string,
    customerDocument: string,
    now = new Date(),
  ) {
    const document = digits(customerDocument);
    const access = await this.prisma.offerAccess.findFirst({
      where: { ownerUserId, customerDocument: document, isActive: true },
      orderBy: { expiresAt: 'desc' },
    });
    if (!access)
      return {
        isActive: false,
        expiresAt: null,
        remainingDays: 0,
        totalDaysCredited: 0,
      };
    await this.expireIfDue(access, now);
    const fresh = await this.prisma.offerAccess.findUniqueOrThrow({
      where: { id: access.id },
    });
    return {
      isActive: isEffectivelyActive(fresh, now),
      expiresAt: fresh.expiresAt,
      remainingDays: remainingDaysOf(fresh.expiresAt, now),
      totalDaysCredited: fresh.totalDaysCredited,
    };
  }

  // ── Mudança de estado ───────────────────────────────────────────────────

  /** Porte de `toggleCustomerPlanAccessStatus`: suspende se ativo, senão reativa. */
  async toggleStatus(id: string, now = new Date()) {
    const access = await this.prisma.offerAccess.findUnique({ where: { id } });
    if (!access) throw new NotFoundException('Acesso ao plano não encontrado');

    if (isEffectivelyActive(access, now)) {
      const next = suspendAccess(stateOf(access), now);
      const updated = await this.prisma.offerAccess.update({
        where: { id },
        data: next,
      });
      await this.notify(updated, 'SUSPENDED');
      return {
        success: true,
        message: 'Acesso ao plano suspenso com sucesso',
        remainingDaysSuspended: next.frozenDays,
      };
    }
    const next = resumeAccess(stateOf(access), now);
    if (!next)
      throw new BadRequestException(
        'Não há dias restantes para reativar este acesso',
      );
    const updated = await this.prisma.offerAccess.update({
      where: { id },
      data: next,
    });
    await this.notify(updated, 'ACTIVE');
    return {
      success: true,
      message: 'Acesso ao plano reativado com sucesso',
      newExpiresAt: next.expiresAt,
      daysReturned: access.frozenDays,
    };
  }

  /**
   * Porte de `forceSetCustomerPlanAccessStatus` (chamado pelo api-pagatg, que já sabe do
   * estado): não notifica de volta.
   */
  async forceStateByCustomer(
    customerId: string,
    isActive: boolean,
    remainingDays: number,
    now = new Date(),
  ): Promise<{ success: boolean; updated: number }> {
    if (!isActive) {
      const accesses = await this.prisma.offerAccess.findMany({
        where: { customerId, isActive: true },
      });
      for (const access of accesses) {
        const next = suspendAccess(stateOf(access), now);
        await this.prisma.offerAccess.update({
          where: { id: access.id },
          data: {
            ...next,
            frozenDays: remainingDays > 0 ? remainingDays : next.frozenDays,
          },
        });
      }
      return { success: true, updated: accesses.length };
    }
    const accesses = await this.prisma.offerAccess.findMany({
      where: { customerId, isActive: false },
    });
    let updated = 0;
    for (const access of accesses) {
      const next = resumeAccess(stateOf(access), now, remainingDays);
      if (!next) continue;
      await this.prisma.offerAccess.update({
        where: { id: access.id },
        data: next,
      });
      updated++;
    }
    return { success: true, updated };
  }

  /** Suspende (oferta inativa) ou reativa (oferta ativa) todos os acessos da oferta. */
  async applyOfferStatus(offerId: string, active: boolean, now = new Date()) {
    const accesses = await this.prisma.offerAccess.findMany({
      where: { offerId },
    });
    const results: Array<Record<string, unknown>> = [];
    for (const access of accesses) {
      const effective = isEffectivelyActive(access, now);
      if (effective === active || (active && access.frozenDays <= 0)) continue;
      try {
        results.push({
          accessId: access.id,
          ...(await this.toggleStatus(access.id, now)),
        });
      } catch (error) {
        results.push({
          accessId: access.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
}
