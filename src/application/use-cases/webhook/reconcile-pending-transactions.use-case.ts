import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { DomTransactionItem, IPaymentGateway } from '../../../core/services/payment-gateway.interface';
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

  /** Consulta direta a cada 5s; para ao sair de PENDING ou atingir 30min de criação. */
  @Interval(5_000)
  async pollRecentPayments(): Promise<void> {
    try {
      await this.execute({ sinceHours: 0.5, minAgeMinutes: 0, direct: true });
    } catch (err) {
      this.logger.error(`[Reconcile][poll] erro: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    /** Consulta individual na DOM, sem depender da listagem paginada. */
    direct?: boolean;
  }): Promise<{ checked: number; completed: number; details: ReconcileDetail[] }> {
    if (this.running) return { checked: 0, completed: 0, details: [] };
    this.running = true;
    try {
      const sinceHours = opts?.sinceHours ?? 72;
      const minAgeMin = opts?.minAgeMinutes ?? 1;
      const now = Date.now();

      const pendings = await this.prisma.transaction.findMany({
        where: {
          status: 'PENDING',
          domPaymentId: { not: null },
          createdAt: { gte: new Date(now - sinceHours * 3_600_000) },
          updatedAt: { lte: new Date(now - minAgeMin * 60_000) },
          ...(opts?.userId ? { userId: opts.userId } : {}),
        },
        select: { id: true, userId: true, domPaymentId: true, domTransactionId: true },
        orderBy: { createdAt: 'desc' },
        take: opts?.direct ? undefined : (opts?.limit ?? 150),
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
      const domMap = new Map<string, DomTransactionItem>();
      const beginDate = this.toYmd(new Date(now - sinceHours * 3_600_000));
      const endDate = this.toYmd(new Date(now));
      if (opts?.direct) {
        for (let offset = 0; offset < pendings.length; offset += 10) {
          await Promise.all(pendings.slice(offset, offset + 10).map(async (tx) => {
            try {
              const detail = await this.gateway.getDomTransactionDetail(domToken, tx.domPaymentId as string);
              // ApiDomClient normaliza o detalhe como { order: { type, total, ... } }.
              const order = detail?.order;
              const status = order?.type ?? detail?.status;
              if (typeof status !== 'string' || !status) return;
              domMap.set(tx.domPaymentId as string, {
                id: tx.domPaymentId as string,
                status,
                amount: Number(order?.total ?? detail?.amount ?? 0),
                liquid_amount: 0,
                payment_method: order?.type_payment ?? detail?.payment_method ?? '',
                created_at: order?.date_register ?? detail?.created_at ?? '',
              });
            } catch (err) {
              this.logger.warn(`[Reconcile][poll] consulta ${tx.id} falhou: ${err instanceof Error ? err.message : String(err)}`);
            }
          }));
        }
      }
      for (let page = 1; !opts?.direct && page <= 40; page++) {
        let txs: DomTransactionItem[] = [];
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
        const dom = domMap.get(domPaymentId)
          ?? (tx.domTransactionId ? domMap.get(tx.domTransactionId) : undefined)
          ?? domMap.get(tx.id);
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
          const settled = await this.prisma.transaction.findUnique({
            where: { id: tx.id },
            select: { status: true },
          });
          if (settled?.status === 'COMPLETED') {
            completed++;
            details.push({ id: tx.id, domPaymentId, domStatus, action: 'completed' });
          } else {
            details.push({ id: tx.id, domPaymentId, domStatus, action: 'kept-pending' });
            this.logger.warn(`[Reconcile] tx ${tx.id} continua pendente após processar status ${domStatus}`);
          }
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
