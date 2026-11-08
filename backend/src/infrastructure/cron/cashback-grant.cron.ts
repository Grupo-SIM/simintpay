import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma/prisma.service';
import { ApiDomClient } from '../http/api-dom.client';

const MAX_ATTEMPTS = 5;
const BATCH = 20;

/** Envia à DOM os cashbacks avulsos pendentes (compras de outras adquirentes). */
@Injectable()
export class CashbackGrantCron {
  private readonly logger = new Logger(CashbackGrantCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dom: ApiDomClient,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron() {
    if (this.running) return;
    this.running = true;
    try {
      const token = process.env.DOM_TOKEN;
      if (!token) return;
      const pending = await this.prisma.cashbackGrant.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      for (const grant of pending) await this.send(token, grant);
    } finally {
      this.running = false;
    }
  }

  private async send(
    token: string,
    grant: {
      id: string;
      transactionId: string;
      valueCents: number;
      attempts: number;
    },
  ) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: grant.transactionId },
      select: {
        status: true,
        customerName: true,
        customerDocument: true,
        customerPhone: true,
      },
    });
    const document = tx?.customerDocument?.replace(/\D/g, '') ?? '';
    const phone = (tx?.customerPhone?.replace(/\D/g, '') ?? '').replace(
      /^55(?=\d{10,11}$)/,
      '',
    );
    const skip =
      !tx || tx.status !== 'COMPLETED'
        ? 'Transação não está paga'
        : document.length !== 11
          ? 'Comprador sem CPF'
          : !/^\d{10,11}$/.test(phone) || !tx.customerName
            ? 'Comprador sem nome ou celular válido'
            : null;
    if (skip || !tx) {
      await this.prisma.cashbackGrant.update({
        where: { id: grant.id },
        data: { status: 'SKIPPED', error: skip ?? 'Transação ausente' },
      });
      return;
    }
    try {
      const result = await this.dom.addStandaloneCashback(token, {
        valueReais: grant.valueCents / 100,
        name: tx.customerName!,
        document,
        mobilePhone: phone,
        codExternal: grant.transactionId,
        idempotencyKey: grant.transactionId,
      });
      await this.prisma.cashbackGrant.update({
        where: { id: grant.id },
        data: {
          status: result.status === 'delivered' ? 'DELIVERED' : 'SENT',
          attempts: { increment: 1 },
          error: null,
        },
      });
    } catch (error) {
      const attempts = grant.attempts + 1;
      const message =
        error instanceof Error ? error.message.slice(0, 300) : 'erro';
      this.logger.warn(`Cashback ${grant.transactionId}: ${message}`);
      await this.prisma.cashbackGrant.update({
        where: { id: grant.id },
        data: {
          attempts,
          error: message,
          status: attempts >= MAX_ATTEMPTS ? 'ERROR' : 'PENDING',
          nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
        },
      });
    }
  }
}
