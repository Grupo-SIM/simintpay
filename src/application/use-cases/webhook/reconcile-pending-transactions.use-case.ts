import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';

/** Status da DOM que significam "pago" (mesma lista do mapStatus do webhook). */
const PAID_STATUSES = new Set(['paid', 'approved', 'completed', 'revision_paid', 'capture']);

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
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly webhook: ProcessDomWebhookUseCase,
  ) {}

  /** Self-healing automático: a cada 10 min completa PENDING que a DOM já aprovou. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cron(): Promise<void> {
    try {
      const res = await this.execute();
      if (res.completed > 0) {
        this.logger.log(`[Reconcile][cron] ${res.completed}/${res.checked} transações completadas`);
      }
    } catch (err) {
      this.logger.error(`[Reconcile][cron] erro: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async execute(opts?: {
    /** Janela de criação a considerar (default 72h). */
    sinceHours?: number;
    /** Idade mínima da última atualização, para não competir com o webhook ao vivo (default 5min). */
    minAgeMinutes?: number;
    /** Máximo de transações por execução (default 150). */
    limit?: number;
    /** Restringe a um dono (ex.: só Renovada). Omitido = todas as plataformas. */
    userId?: string;
  }): Promise<{ checked: number; completed: number; details: ReconcileDetail[] }> {
    if (this.running) return { checked: 0, completed: 0, details: [] };
    this.running = true;
    try {
      const sinceHours = opts?.sinceHours ?? 72;
      const minAgeMin = opts?.minAgeMinutes ?? 5;
      const now = Date.now();

      const pendings = await this.prisma.transaction.findMany({
        where: {
          status: 'PENDING',
          domPaymentId: { not: null },
          createdAt: { gte: new Date(now - sinceHours * 3_600_000) },
          updatedAt: { lte: new Date(now - minAgeMin * 60_000) },
          ...(opts?.userId ? { userId: opts.userId } : {}),
        },
        select: { id: true, userId: true, domPaymentId: true },
        orderBy: { createdAt: 'desc' },
        take: opts?.limit ?? 150,
      });

      const details: ReconcileDetail[] = [];
      if (pendings.length === 0) return { checked: 0, completed: 0, details };

      // Token master — mesma fonte do GET /admin/transacoes-dom, que retorna o status correto da DOM.
      // (O /transactions/{id} de detalhe voltava status vazio; a listagem paginada funciona.)
      const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
      if (!domToken) {
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
      const domMap = new Map<string, any>();
      const beginDate = this.toYmd(new Date(now - sinceHours * 3_600_000));
      const endDate = this.toYmd(new Date(now));
      for (let page = 1; page <= 40; page++) {
        let txs: any[] = [];
        try {
          const res = await this.gateway.listDomTransactions(domToken, {
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

      let completed = 0;
      for (const tx of pendings) {
        const domPaymentId = tx.domPaymentId as string;
        const dom = domMap.get(domPaymentId);
        const domStatus = String(dom?.status ?? '').toLowerCase();

        if (!dom || !PAID_STATUSES.has(domStatus)) {
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
          signature: `reconcile:${domPaymentId}`,
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

        try {
          await this.webhook.execute(payload);
          completed++;
          details.push({ id: tx.id, domPaymentId, domStatus, action: 'completed' });
        } catch (err) {
          details.push({
            id: tx.id,
            domPaymentId,
            domStatus,
            action: `error:${err instanceof Error ? err.message : 'unknown'}`,
          });
        }
      }

      return { checked: pendings.length, completed, details };
    } finally {
      this.running = false;
    }
  }

  /** YYYY-MM-DD para o begin_date/end_date da listagem DOM. */
  private toYmd(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
