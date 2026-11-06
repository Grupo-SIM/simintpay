import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'America/Sao_Paulo';
/** Dias antes do vencimento (0 = no dia) em que o comprador é avisado (igual ao legado). */
export const ACCESS_REMINDER_OFFSETS = [3, 2, 1, 0] as const;
export const ACCESS_REMINDER_EVENT_TYPE = 'EXPIRY_REMINDER';

export const accessReminderKey = (
  accessId: string,
  expiresAt: Date,
  offsetDays: number,
) => `reminder:${accessId}:${expiresAt.toISOString()}:${offsetDays}`;

export type AccessReminderResult = {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
};

/**
 * Avisa por e-mail quem tem crédito de dias prestes a vencer. Um e-mail por
 * (acesso, vencimento, antecedência): o `OfferAccessEvent` único é criado ANTES do envio e
 * marcado como entregue só depois, então uma falha é refeita na próxima rodada e um sucesso
 * nunca se repete (mesmo padrão do `RenewalReminderService`).
 */
@Injectable()
export class OfferAccessReminderService {
  private readonly logger = new Logger(OfferAccessReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async run(now: Date = new Date()): Promise<AccessReminderResult> {
    const result: AccessReminderResult = {
      considered: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
    const today = dayjs(now).tz(TZ).startOf('day');
    const windowEnd = today.add(
      Math.max(...ACCESS_REMINDER_OFFSETS) + 1,
      'day',
    );
    const accesses = await this.prisma.offerAccess.findMany({
      where: {
        isActive: true,
        expiresAt: { gte: today.toDate(), lt: windowEnd.toDate() },
      },
      include: {
        offer: { include: { codeAliases: { where: { isActive: true } } } },
      },
    });

    for (const access of accesses) {
      const offset = dayjs(access.expiresAt)
        .tz(TZ)
        .startOf('day')
        .diff(today, 'day');
      if (!(ACCESS_REMINDER_OFFSETS as readonly number[]).includes(offset))
        continue;
      result.considered++;
      const eventKey = accessReminderKey(access.id, access.expiresAt, offset);
      const event = await this.claimEvent(access.id, eventKey, {
        expiresAt: access.expiresAt.toISOString(),
        offsetDays: offset,
        to: access.customerEmail,
      });
      if (!event) {
        result.skipped++;
        continue;
      }
      try {
        const px = access.offer.codeAliases.find((a) => a.kind === 'PX');
        await this.email.sendExpirationReminder({
          to: access.customerEmail,
          customerName: access.customerName || 'Cliente',
          planName: access.offer.name,
          expiresAt: access.expiresAt,
          daysRemaining: offset,
          renewUrl: px ? `https://paga-tg.com/checkout/${px.code}` : undefined,
        });
        await this.prisma.offerAccessEvent.update({
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
        await this.prisma.offerAccessEvent
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

  /** O evento a entregar, ou null quando este lembrete já foi entregue. */
  private async claimEvent(
    accessId: string,
    eventKey: string,
    payload: Prisma.InputJsonObject,
  ): Promise<{ id: string } | null> {
    try {
      return await this.prisma.offerAccessEvent.create({
        data: {
          accessId,
          eventKey,
          type: ACCESS_REMINDER_EVENT_TYPE,
          payload,
        },
        select: { id: true },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
    }
    const existing = await this.prisma.offerAccessEvent.findUnique({
      where: { eventKey },
      select: { id: true, deliveredAt: true },
    });
    return existing && !existing.deliveredAt ? { id: existing.id } : null;
  }
}
