import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { DomTransactionItem, IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';

/** Status da DOM que significam "pago" (mesma lista do mapStatus do webhook). */
const PAID_STATUSES = new Set(['paid', 'approved', 'completed', 'revision_paid', 'capture']);
const FAILURE_STATUSES: Record<string, string> = { failed: 'FAILED', not_authorized: 'FAILED', expired: 'EXPIRED' };

type ReconcileDetail = { id: string; domPaymentId: string; domStatus?: string; action: string };

/**
 * Reconciliação de transações PENDENTES contra a DOM (fonte da verdade).
 *
 * Problema: em ~1-5% dos casos o webhook de confirmação da DOM se perde/falha, e a transação
 * fica PENDING localmente mesmo tendo sido aprovada na DOM (sem creditar a carteira).
 *
 * Solução: periodicamente (e sob demanda) consultamos o status de cada PENDING na DOM. Se a DOM
 * diz "pago", reprocessamos pelo MESMO caminho do webhook (`ProcessDomWebhookUseCase.execute`),
 * que credita a carteira, emite o SSE e é idempotente (via `webhookEvent.eventId`).
 */
@Injectable()
export class ReconcilePendingTransactionsUseCase {
  private readonly logger = new Logger(ReconcilePendingTransactionsUseCase.name);
  private readonly activeRuns = new Map<string, { mode: string; startedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly webhook: ProcessDomWebhookUseCase,
  ) {}

  /** Consulta direta a cada 5s; para ao sair de PENDING ou atingir 30min de criação. */
  async pollRecentPayments(): Promise<void> {
    try {
      await this.execute({ sinceHours: 0.5, minAgeMinutes: 0, direct: true });
    } catch (err) {
      this.logger.error(`[Reconcile][poll] erro: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Query DOM and settle locally before reporting approval to an integration. */
  async reconcilePayment(paymentId: string, userId: string, domToken?: string): Promise<{ paymentId: string; status: string }> {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        userId,
        acquirer: 'DOM',
        OR: [{ domPaymentId: paymentId }, { domTransactionId: paymentId }],
      },
      select: { id: true, domPaymentId: true, status: true },
    });
    this.logger.log(`[Reconcile][status] lookup: paymentId=${paymentId} userId=${userId} tx=${transaction?.id ?? 'missing'} localStatus=${transaction?.status ?? 'NOT_FOUND'}`);
    if (!transaction) return { paymentId, status: 'NOT_FOUND' };
    if (transaction.status === 'PENDING' && transaction.domPaymentId) {
      await this.execute({ direct: true, minAgeMinutes: 0, transactionId: transaction.id, userId, domToken });
      const settled = await this.prisma.transaction.findUnique({ where: { id: transaction.id }, select: { status: true } });
      return { paymentId: transaction.domPaymentId, status: settled?.status ?? transaction.status };
    }
    return { paymentId: transaction.domPaymentId ?? paymentId, status: transaction.status };
  }

  async execute(opts?: {
    /** Janela de criação a considerar (default 72h). */
    sinceHours?: number;
    /** Idade mínima da última atualização, para não competir com o webhook ao vivo (default 1min). */
    minAgeMinutes?: number;
    /** Máximo de transações por execução (default 150). */
    limit?: number;
    /** Restringe a um dono (ex.: só Renovada). Omitido = todas as plataformas. */
    userId?: string;
    /** Targeted status checks ignore the recent-payment window. */
    transactionId?: string;
    /** Credential used by the integration that created the payment. */
    domToken?: string;
    /** Consulta individual na DOM, sem depender da listagem paginada. */
    direct?: boolean;
  }): Promise<{ checked: number; completed: number; details: ReconcileDetail[] }> {
    const mode = opts?.transactionId ? 'status' : opts?.direct ? 'poll' : 'list';
    const runKey = opts?.transactionId ?? mode;
    const prefix = `[Reconcile][${mode}]`;
    const startedAt = Date.now();
    const activeRun = this.activeRuns.get(runKey);
    if (activeRun) {
      this.logger.warn(`${prefix} skipped: activeMode=${activeRun.mode} activeDurationMs=${startedAt - activeRun.startedAt}`);
      return { checked: 0, completed: 0, details: [] };
    }
    this.activeRuns.set(runKey, { mode, startedAt });
    let checked = 0;
    let completed = 0;
    let outcome = 'error';
    try {
      const sinceHours = opts?.sinceHours ?? 72;
      const minAgeMin = opts?.minAgeMinutes ?? 1;
      const now = Date.now();

      this.logger.log(`${prefix} started: sinceHours=${sinceHours} minAgeMinutes=${minAgeMin} userId=${opts?.userId ?? 'all'} limit=${opts?.direct ? 'all' : (opts?.limit ?? 150)} createdSince=${new Date(now - sinceHours * 3_600_000).toISOString()} updatedBefore=${new Date(now - minAgeMin * 60_000).toISOString()}`);

      const pendings = await this.prisma.transaction.findMany({
        where: {
          status: 'PENDING',
          acquirer: 'DOM',
          domPaymentId: { not: null },
          ...(opts?.transactionId
            ? { id: opts.transactionId }
            : { createdAt: { gte: new Date(now - sinceHours * 3_600_000) } }),
          updatedAt: { lte: new Date(now - minAgeMin * 60_000) },
          ...(opts?.userId ? { userId: opts.userId } : {}),
        },
        select: { id: true, userId: true, domPaymentId: true, domTransactionId: true, description: true, user: { select: { domToken: true } } },
        orderBy: { createdAt: 'desc' },
        take: opts?.direct ? undefined : (opts?.limit ?? 150),
      });

      const details: ReconcileDetail[] = [];
      checked = pendings.length;
      this.logger.log(`${prefix} selected: checked=${checked}`);
      if (pendings.length === 0) {
        outcome = 'no-pending';
        return { checked: 0, completed: 0, details };
      }

      // Paginated reconciliation uses the master credential; direct checks prefer the
      // integration/seller credential that can access the individual payment.
      const domToken = opts?.domToken || process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
      if (!domToken && !opts?.direct) {
        outcome = 'no-master-token';
        this.logger.warn(`${prefix} skipped: no master token configured checked=${checked}`);
        return {
          checked: pendings.length,
          completed: 0,
          details: pendings.map((t) => ({
            id: t.id,
            domPaymentId: t.domPaymentId as string,
            action: 'skip:no-master-token',
          })),
        };
      }

      // Monta um mapa das transações da DOM na janela, indexado por id / order_id / cod_external.
      const domMap = new Map<string, DomTransactionItem>();
      const beginDate = this.toYmd(new Date(now - sinceHours * 3_600_000));
      const endDate = this.toYmd(new Date(now));
      if (opts?.direct) {
        for (let offset = 0; offset < pendings.length; offset += 10) {
          await Promise.all(pendings.slice(offset, offset + 10).map(async (tx) => {
            const queryStartedAt = Date.now();
            const transactionContext = `tx=${tx.id} domPaymentId=${tx.domPaymentId}`;
            this.logger.log(`${prefix} DOM request: ${transactionContext}`);
            try {
              const queryToken = opts?.domToken
                || (tx.description?.includes('[TENANT:ZERO_GRAU]') ? process.env.ZERO_GRAU_DOM_TOKEN : undefined)
                || tx.user?.domToken
                || domToken;
              if (!queryToken) {
                this.logger.warn(`${prefix} DOM request skipped: ${transactionContext} reason=no-token`);
                return;
              }
              const detail = await this.gateway.getDomTransactionDetail(queryToken, tx.domPaymentId as string);
              // ApiDomClient normaliza o detalhe como { order: { type, total, ... } }.
              const order = detail?.order;
              const status = order?.type ?? detail?.status;
              const durationMs = Date.now() - queryStartedAt;
              if (typeof status !== 'string' || !status) {
                this.logger.warn(`${prefix} DOM response: ${transactionContext} status=missing durationMs=${durationMs}`);
                return;
              }
              this.logger.log(`${prefix} DOM response: ${transactionContext} status=${status} durationMs=${durationMs}`);
              domMap.set(tx.domPaymentId as string, {
                id: tx.domPaymentId as string,
                status,
                amount: Number(order?.total ?? detail?.amount ?? 0),
                liquid_amount: 0,
                payment_method: order?.type_payment ?? detail?.payment_method ?? '',
                created_at: order?.date_register ?? detail?.created_at ?? '',
              });
            } catch (err) {
              this.logger.warn(`${prefix} DOM request failed: ${transactionContext} durationMs=${Date.now() - queryStartedAt} error=${err instanceof Error ? err.message : String(err)}`);
            }
          }));
        }
      }
      for (let page = 1; !opts?.direct && page <= 40; page++) {
        let txs: DomTransactionItem[] = [];
        try {
          const res = await this.gateway.listDomTransactions(domToken as string, {
            page,
            limit: 100,
            begin_date: beginDate,
            end_date: endDate,
          });
          txs = res.transactions ?? [];
        } catch (err) {
          this.logger.warn(
            `[Reconcile] erro ao listar DOM (p.${page}): ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }
        for (const t of txs) {
          if (t.id) domMap.set(String(t.id), t);
          if (t.order_id) domMap.set(String(t.order_id), t);
          if (t.cod_external) domMap.set(String(t.cod_external), t);
        }
        if (txs.length < 100) break;
      }

      for (const tx of pendings) {
        const domPaymentId = tx.domPaymentId as string;
        const dom = domMap.get(domPaymentId)
          ?? (tx.domTransactionId ? domMap.get(tx.domTransactionId) : undefined)
          ?? domMap.get(tx.id);
        const domStatus = String(dom?.status ?? '').trim().toLowerCase();

        const expectedStatus = PAID_STATUSES.has(domStatus) ? 'COMPLETED'
          : opts?.transactionId ? FAILURE_STATUSES[domStatus] : undefined;
        if (!dom || !expectedStatus) {
          this.logger.log(`${prefix} kept-pending: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${dom ? domStatus : 'not-found'} reason=${dom ? 'not-paid' : 'no-DOM-match'}`);
          details.push({
            id: tx.id,
            domPaymentId,
            domStatus: dom ? domStatus : '(não encontrada na DOM)',
            action: 'kept-pending',
          });
          continue;
        }

        // Reprocessa pelo caminho do webhook (credita carteira + SSE, idempotente via signature).
        // NÃO passamos liquid_amount de propósito: o handleTransaction usa o netAmount já gravado na
        // transação — mesmo valor de uma conclusão normal — em vez do líquido "enriquecido" da lista.
        const payload = {
          event: `reconcile.${domStatus}`,
          signature: expectedStatus === 'COMPLETED' ? `reconcile:${domPaymentId}` : `reconcile:${domPaymentId}:${domStatus}`,
          data: {
            id: domPaymentId,
            status: domStatus,
            amount: Math.round(Number(dom.amount ?? 0) * 100),
            payment_method: dom.payment_method,
            created_at: dom.created_at,
            customer: {
              name: dom.customer_name,
              email: dom.customer_email,
              document: dom.customer_document,
              mobile_phone: dom.customer_phone,
            },
          },
        };

        const webhookStartedAt = Date.now();
        this.logger.log(`${prefix} webhook started: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${domStatus}`);
        try {
          await this.webhook.execute(payload);
          const settled = await this.prisma.transaction.findUnique({
            where: { id: tx.id },
            select: { status: true },
          });
          if (settled?.status === 'COMPLETED') {
            completed++;
            this.logger.log(`${prefix} completed: tx=${tx.id} domPaymentId=${domPaymentId} durationMs=${Date.now() - webhookStartedAt}`);
            details.push({ id: tx.id, domPaymentId, domStatus, action: 'completed' });
          } else if (settled?.status === expectedStatus) {
            this.logger.log(`${prefix} settled: tx=${tx.id} domPaymentId=${domPaymentId} localStatus=${settled.status} durationMs=${Date.now() - webhookStartedAt}`);
            details.push({ id: tx.id, domPaymentId, domStatus, action: `settled:${settled.status}` });
          } else {
            details.push({ id: tx.id, domPaymentId, domStatus, action: 'kept-pending' });
            this.logger.warn(`${prefix} webhook did not complete: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${domStatus} localStatus=${settled?.status ?? 'missing'} durationMs=${Date.now() - webhookStartedAt}`);
          }
        } catch (err) {
          this.logger.error(`${prefix} webhook failed: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${domStatus} durationMs=${Date.now() - webhookStartedAt} error=${err instanceof Error ? err.message : String(err)}`);
          details.push({
            id: tx.id,
            domPaymentId,
            domStatus,
            action: `error:${err instanceof Error ? err.message : 'unknown'}`,
          });
        }
      }

      outcome = 'finished';
      return { checked: pendings.length, completed, details };
    } catch (err) {
      this.logger.error(`${prefix} run failed: error=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      this.logger.log(`${prefix} ended: outcome=${outcome} checked=${checked} completed=${completed} durationMs=${Date.now() - startedAt}`);
      this.activeRuns.delete(runKey);
    }
  }

  /** YYYY-MM-DD para o begin_date/end_date da listagem DOM. */
  private toYmd(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
