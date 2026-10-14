import { PlatformHistoricalSync } from './platform-historical-sync';
import { canSyncTransition, conflictingPlatformMarker, hasPlatformMarker, platformSyncAdapter, syncStatus } from './platform-sync.adapter';
import { Inject, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY, type IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';
import { PlatformEventsService } from './platform-events.service';

/** Corporate adapters select and normalize; writes, wallet deltas and dedup are shared. */
@Injectable()
export class PlatformSyncPersistenceService {
  constructor(private readonly prisma: PrismaService, private readonly http: HttpService,
    private readonly events: PlatformEventsService, @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway) {}

  private readonly running = new Map<string, { mode: string; task: Promise<unknown> }>();

  private run(tag: string, mode: string, execute: () => Promise<unknown>): Promise<unknown> {
    const active = this.running.get(tag);
    if (active) return active.mode === mode ? active.task : active.task.catch(() => undefined).then(() => this.run(tag, mode, execute));
    const task = execute().finally(() => { if (this.running.get(tag)?.task === task) this.running.delete(tag); });
    this.running.set(tag, { mode, task });
    return task;
  }
  poll(tag: string) { return this.run(tag, 'poll', () => this.executePoll(tag)); }
  history(tag: string, context?: import('./platform-context.service').PlatformContext) { return this.run(tag, 'history', () => new PlatformHistoricalSync(this.prisma, this.gateway, this.persist.bind(this)).run(tag, context)); }

  private async executePoll(tag: string) {
    const platform = await this.prisma.platform.findUnique({ where: { tag }, include: { owner: true } });
    if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged || platform.acquirer !== 'DOM') return;
    const adapter = platformSyncAdapter(tag);
    if (!adapter) return;
    const direct = adapter.transport === 'DOM';
    if (getPlatformIntegrationValue(tag, 'DISABLE_SYNC') === 'true' || (direct && getPlatformIntegrationValue(tag, 'ENABLE_DOM_SYNC') !== 'true')) return;
    const token = getPlatformIntegrationValue(tag, direct ? 'DOM_TOKEN' : 'API_DOM_XTOKEN');
    const base = getPlatformIntegrationValue(tag, 'DOM_BACKEND_URL');
    if (!token || (!direct && !base)) return;
    let changed = 0;
    for (let page = 1; page <= 3; page++) {
      const rows: any[] = direct
        ? (await this.gateway.listDomTransactions(token, { page, limit: 100, begin_date: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10) })).transactions ?? []
        : (await firstValueFrom(this.http.get<any>(`${base}/payments/history`, { headers: { 'x-access-token': token, Accept: 'application/json' }, params: { page, limit: 100 }, timeout: 15000 }))).data?.transactions ?? [];
      for (const row of rows) {
        const description = String(row.product_first ?? row.description ?? '');
        if (!adapter.accepts(description) || conflictingPlatformMarker(description, tag)) continue;
        if (await this.persist(platform, row, description)) changed++;
      }
      if (rows.length < 100) break;
    }
    return { updated: changed };
  }

  private async persist(platform: { id: string; tag: string; ownerUserId: string }, row: any, description: string) {
    const paymentId = String(row.order_id ?? row.paymentId ?? row.id ?? '');
    const transactionId = row.id == null ? null : String(row.id);
    if (!paymentId) return false;
    let amount: Prisma.Decimal, netAmount: Prisma.Decimal, totalFee: Prisma.Decimal, domFee: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(row.amount ?? 0);
      netAmount = new Prisma.Decimal(row.liquid_amount ?? row.amountWithoutAllFee ?? amount.mul('0.91'));
      totalFee = new Prisma.Decimal(row.fee_total ?? row.fee ?? 0);
      domFee = new Prisma.Decimal(row.dom_fee ?? 0);
    } catch { return false; }
    if (!totalFee.isFinite() || !domFee.isFinite() || totalFee.lt(0) || domFee.lt(0)) return false;
    if (!amount.isFinite() || !netAmount.isFinite() || amount.lt(0) || netAmount.lt(0)) return false;
    const status = syncStatus(row.status);
    if (!status) return false;
    const createdAt = row.created_at == null ? undefined : new Date(row.created_at);
    if (createdAt && !Number.isFinite(createdAt.getTime())) return false;
    const marker = `[TENANT:${platform.tag}]`;
    const data = { amount, netAmount, totalFee, domFee, platformFee: Prisma.Decimal.max(0, totalFee.minus(domFee)), status,
      description: description.includes(marker) ? description : `${description} ${marker}`,
      customerName: row.customer_name ?? row.name, customerEmail: row.customer_email ?? row.email,
      customerDocument: row.customer_document ?? row.document, customerPhone: row.customer_phone ?? row.mobile_phone };
    let stored: unknown;
    try {
      stored = await this.prisma.$transaction(async tx => {
        const active = await tx.platform.findUnique({ where: { id: platform.id }, include: { owner: true } });
        if (!active?.isActive || !active.owner.isActive || active.owner.isPurged || active.ownerUserId !== platform.ownerUserId) return null;
        const existing = await tx.transaction.findFirst({ where: { OR: [{ domPaymentId: paymentId }, ...(transactionId ? [{ domTransactionId: transactionId }] : [])] } });
        if (existing && (!hasPlatformMarker(existing.description, platform.tag) || existing.acquirer !== 'DOM')) return null;
        // Historical transaction always belongs to original wallet, even after ownership transfer.
        const userId = existing?.userId ?? platform.ownerUserId;
        const canonical = /^[a-f0-9]{64}$/.test(existing?.id ?? '');
        const grossWallet = platformSyncAdapter(platform.tag)?.grossWallet === true && !canonical;
        if (existing && !canSyncTransition(existing.status, status)) return null;
        if (canonical && (!amount.equals(existing!.amount) || existing!.netAmount === null)) return null;
        const value = canonical ? new Prisma.Decimal(existing!.netAmount!) : grossWallet ? amount : netAmount;
        const updateData = canonical ? { status } : data;
        const before = existing?.status === 'COMPLETED' ? new Prisma.Decimal(grossWallet ? existing.amount : existing.netAmount ?? existing.amount) : new Prisma.Decimal(0);
        const after = status === 'COMPLETED' ? value : new Prisma.Decimal(0);
        let result;
        if (existing) {
          if (existing.status === status) return null;
          const updated = await tx.transaction.updateMany({ where: { id: existing.id, status: existing.status }, data: { ...updateData, previousStatus: existing.status } });
          if (!updated.count) return null;
          result = { ...existing, ...updateData };
        } else {
          result = await tx.transaction.create({ data: { ...data, ...(createdAt ? { createdAt } : {}), userId, domPaymentId: paymentId, domTransactionId: transactionId, acquirer: 'DOM', paymentMethod: /card|credit/i.test(row.payment_method ?? '') ? 'CREDIT_CARD' : 'PIX', installments: row.installments ?? 1 } });
        }
        const delta = after.minus(before);
        if (!delta.isZero()) await tx.wallet.update({ where: { userId }, data: { balance: { increment: delta }, version: { increment: 1 } } });
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    if (stored) this.events.emit(platform.tag, 'transaction', stored);
    return !!stored;
  }
}
