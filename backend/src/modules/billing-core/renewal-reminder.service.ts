import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { RENEWAL_LINK_BUILDER, type RenewalLinkBuilder } from './renewal-link';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'America/Sao_Paulo';
/** Days before `currentPeriodEnd` (0 = the due day) on which the buyer is reminded. */
export const REMINDER_OFFSETS = [30, 7, 1, 0] as const;
export const REMINDER_EVENT_TYPE = 'RENEWAL_REMINDER';

export const reminderEventKey = (
  contractId: string,
  periodEnd: Date,
  offsetDays: number,
) => `reminder:${contractId}:${periodEnd.toISOString()}:${offsetDays}`;

export type RenewalReminderResult = {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
};

/**
 * Warns buyers whose next cycle is paid by themselves (no ACTIVE stored card) before the period
 * of a BillingContract ends. One e-mail per (contract, periodEnd, offset): the unique
 * BillingContractEvent is created BEFORE sending and marked delivered only after the e-mail
 * went out, so a failure is retried by the next run and a success is never repeated.
 */
@Injectable()
export class RenewalReminderService {
  private readonly logger = new Logger(RenewalReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Inject(RENEWAL_LINK_BUILDER) private readonly links: RenewalLinkBuilder,
  ) {}

  async run(now: Date = new Date()): Promise<RenewalReminderResult> {
    const result: RenewalReminderResult = {
      considered: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
    const today = dayjs(now).tz(TZ).startOf('day');
    const windowEnd = today.add(Math.max(...REMINDER_OFFSETS) + 1, 'day');
    const contracts = await this.prisma.billingContract.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        offerId: { not: null },
        customerEmail: { not: null },
        currentPeriodEnd: { gte: today.toDate(), lt: windowEnd.toDate() },
        storedCards: { none: { status: 'ACTIVE' } },
      },
      include: { offer: true },
    });

    for (const contract of contracts) {
      const offset = dayjs(contract.currentPeriodEnd)
        .tz(TZ)
        .startOf('day')
        .diff(today, 'day');
      if (!(REMINDER_OFFSETS as readonly number[]).includes(offset)) continue;
      if (!contract.offer || !contract.customerEmail) continue;
      result.considered++;

      const eventKey = reminderEventKey(
        contract.id,
        contract.currentPeriodEnd,
        offset,
      );
      const event = await this.claimEvent(contract.id, eventKey, {
        periodEnd: contract.currentPeriodEnd.toISOString(),
        offsetDays: offset,
        to: contract.customerEmail,
      });
      if (!event) {
        result.skipped++;
        continue;
      }
      try {
        await this.email.sendRenewalReminder({
          to: contract.customerEmail,
          customerName: contract.customerName || 'Cliente',
          offerName: contract.offer.name,
          amount: Number(contract.unitAmount) * contract.quantity,
          dueDate: contract.currentPeriodEnd,
          daysRemaining: offset,
          renewUrl: this.links.build({
            contractId: contract.id,
            offerCode: contract.offer.code,
          }),
        });
        await this.prisma.billingContractEvent.update({
          where: { id: event.id },
          data: {
            deliveredAt: new Date(),
            attempts: { increment: 1 },
            lastError: null,
          },
        });
        result.sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Lembrete ${eventKey} falhou: ${message}`);
        await this.prisma.billingContractEvent
          .update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              lastError: message.slice(0, 500),
            },
          })
          .catch(() => undefined);
        result.failed++;
      }
    }
    return result;
  }

  /** The event to deliver, or null when this reminder was already delivered. */
  private async claimEvent(
    contractId: string,
    eventKey: string,
    payload: Prisma.InputJsonObject,
  ): Promise<{ id: string } | null> {
    try {
      return await this.prisma.billingContractEvent.create({
        data: { contractId, eventKey, type: REMINDER_EVENT_TYPE, payload },
        select: { id: true },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
    }
    const existing = await this.prisma.billingContractEvent.findUnique({
      where: { eventKey },
      select: { id: true, deliveredAt: true },
    });
    return existing && !existing.deliveredAt ? { id: existing.id } : null;
  }
}
