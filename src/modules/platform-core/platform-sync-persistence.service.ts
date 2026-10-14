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

  async poll(tag: string) {
    const platform = await this.prisma.platform.findUnique({ where: { tag }, include: { owner: true } });
    if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged || platform.acquirer !== 'DOM') return;
    const direct = tag === 'ATLAS' || tag === 'REVALIDA';
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
        const lower = description.toLowerCase();
        if (direct && !lower.includes(tag.toLowerCase())) continue;
        if (tag === 'RENOVADA' && (description.startsWith('PIX_PLAN_CODE:') || !['dizimo', 'dízimo', 'primicia', 'primícia', 'oferta', 'fundacao', 'fundação', 'maquineta', 'terminal'].some(word => lower.includes(word)))) continue;
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
    const amount = new Prisma.Decimal(row.amount ?? 0);
    const netAmount = new Prisma.Decimal(row.liquid_amount ?? row.amountWithoutAllFee ?? amount.mul('0.91'));
    if (amount.lt(0) || netAmount.lt(0)) return false;
    const raw = String(row.status ?? '').toLowerCase();
    const status = ['paid', 'approved', 'completed'].includes(raw) ? TransactionStatus.COMPLETED
      : ['refused', 'canceled', 'failed', 'error', 'not_authorized'].includes(raw) ? TransactionStatus.FAILED
      : raw === 'refunded' ? TransactionStatus.REFUNDED : raw === 'expired' ? TransactionStatus.EXPIRED
      : raw === 'chargeback' ? TransactionStatus.CHARGEBACK : TransactionStatus.PENDING;
    const totalFee = new Prisma.Decimal(row.fee_total ?? row.fee ?? 0);
    const domFee = new Prisma.Decimal(row.dom_fee ?? 0);
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
        if (existing && (!existing.description?.includes(marker) || existing.acquirer !== 'DOM')) return null;
        // Historical transaction always belongs to original wallet, even after ownership transfer.
        const userId = existing?.userId ?? platform.ownerUserId;
        const grossWallet = platform.tag !== 'BOSQUE' && !/^[a-f0-9]{64}$/.test(existing?.id ?? '');
        const value = grossWallet ? amount : netAmount;
        const before = existing?.status === 'COMPLETED' ? new Prisma.Decimal(grossWallet ? existing.amount : existing.netAmount ?? existing.amount) : new Prisma.Decimal(0);
        const after = status === 'COMPLETED' ? value : new Prisma.Decimal(0);
        let result;
        if (existing) {
          if (existing.status === status) return null;
          const updated = await tx.transaction.updateMany({ where: { id: existing.id, status: existing.status }, data: { ...data, previousStatus: existing.status } });
          if (!updated.count) return null;
          result = { ...existing, ...data };
        } else {
          result = await tx.transaction.create({ data: { ...data, userId, domPaymentId: paymentId, domTransactionId: transactionId, acquirer: 'DOM', paymentMethod: /card|credit/i.test(row.payment_method ?? '') ? 'CREDIT_CARD' : 'PIX', installments: row.installments ?? 1 } });
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
