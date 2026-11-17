import { whereTransactionPlatform } from '../../../modules/platform-core/transaction-platform';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type {
  DomTransactionItem,
  IPaymentGateway,
} from '../../../core/services/payment-gateway.interface';
import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';
import { PaymentAttemptsService } from '../../../modules/unified-platform/payments/payment-attempts.service';

/** Status da DOM que significam "pago" (mesma lista do mapStatus do webhook). */
const PAID_STATUSES = new Set([
  'paid',
  'approved',
  'completed',
  'revision_paid',
  'capture',
]);
const FAILURE_STATUSES: Record<string, string> = {
  failed: 'FAILED',
  not_authorized: 'FAILED',
  expired: 'EXPIRED',
};

/** Janela, idade mínima e prazo de expiração para DRAFTs sem domPaymentId. */
const ORPHAN_WINDOW_HOURS = 72;
const ORPHAN_MIN_AGE_MINUTES = 2;
const ORPHAN_EXPIRE_AFTER_HOURS = 26;

type ReconcileDetail = {
  id: string;
  domPaymentId: string;
  domStatus?: string;
  action: string;
};

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
  private readonly logger = new Logger(
    ReconcilePendingTransactionsUseCase.name,
  );
  private readonly activeRuns = new Map<
    string,
    { mode: string; startedAt: number }
  >();

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
      this.logger.error(
        `[Reconcile][poll] erro: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Query DOM and settle locally before reporting approval to an integration. */
  async reconcilePayment(
    paymentId: string,
    userId: string,
    domToken?: string,
  ): Promise<{ paymentId: string; status: string }> {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        userId,
        acquirer: 'DOM',
        OR: [{ domPaymentId: paymentId }, { domTransactionId: paymentId }],
      },
      select: { id: true, domPaymentId: true, status: true },
    });
    this.logger.log(
      `[Reconcile][status] lookup: paymentId=${paymentId} userId=${userId} tx=${transaction?.id ?? 'missing'} localStatus=${transaction?.status ?? 'NOT_FOUND'}`,
    );
    if (!transaction) return { paymentId, status: 'NOT_FOUND' };
    if (transaction.status === 'PENDING' && transaction.domPaymentId) {
      await this.execute({
        direct: true,
        minAgeMinutes: 0,
        transactionId: transaction.id,
        userId,
        domToken,
      });
      const settled = await this.prisma.transaction.findUnique({
        where: { id: transaction.id },
        select: { status: true },
      });
      return {
        paymentId: transaction.domPaymentId,
        status: settled?.status ?? transaction.status,
      };
    }
    return {
      paymentId: transaction.domPaymentId ?? paymentId,
      status: transaction.status,
    };
  }

  async execute(opts?: {
    /** Janela de criação a considerar (default 72h). */
    sinceHours?: number;
    /** Explicit product scope; conflicting legacy tags are excluded before gateway calls. */
    platformTag?: string;
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
  }): Promise<{
    checked: number;
    completed: number;
    details: ReconcileDetail[];
  }> {
    const mode = opts?.transactionId
      ? 'status'
      : opts?.direct
        ? 'poll'
        : 'list';
    const runKey =
      opts?.transactionId ??
      `${mode}:${opts?.platformTag ?? '*'}:${opts?.userId ?? '*'}`;
    const prefix = `[Reconcile][${mode}]`;
    const startedAt = Date.now();
    const activeRun = this.activeRuns.get(runKey);
    if (activeRun) {
      this.logger.warn(
        `${prefix} skipped: activeMode=${activeRun.mode} activeDurationMs=${startedAt - activeRun.startedAt}`,
      );
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

      this.logger.log(
        `${prefix} started: sinceHours=${sinceHours} minAgeMinutes=${minAgeMin} userId=${opts?.userId ?? 'all'} limit=${opts?.direct ? 'all' : (opts?.limit ?? 150)} createdSince=${new Date(now - sinceHours * 3_600_000).toISOString()} updatedBefore=${new Date(now - minAgeMin * 60_000).toISOString()}`,
      );

      const candidates = await this.prisma.transaction.findMany({
        where: {
          status: 'PENDING',
          acquirer: 'DOM',
          ...(opts?.platformTag
            ? whereTransactionPlatform(opts.platformTag)
            : {}),
          domPaymentId: { not: null },
          ...(opts?.transactionId
            ? { id: opts.transactionId }
            : { createdAt: { gte: new Date(now - sinceHours * 3_600_000) } }),
          updatedAt: { lte: new Date(now - minAgeMin * 60_000) },
          ...(opts?.userId ? { userId: opts.userId } : {}),
        },
        select: {
          id: true,
          userId: true,
          domPaymentId: true,
          domTransactionId: true,
          description: true,
          platformTag: true,
        },
        orderBy: { createdAt: 'desc' },
        take: opts?.platformTag
          ? (opts.limit ?? 500)
          : opts?.direct
            ? undefined
            : (opts?.limit ?? 150),
      });

      const pendings = candidates;
      const details: ReconcileDetail[] = [];
      checked = pendings.length;
      this.logger.log(`${prefix} selected: checked=${checked}`);
      if (pendings.length === 0) {
        outcome = 'no-pending';
        return { checked: 0, completed: 0, details };
      }

      // Paginated reconciliation uses the master credential; direct checks prefer the
      // integration/seller credential that can access the individual payment.
      const domToken = opts?.domToken || process.env.DOM_TOKEN;
      if (!domToken && !opts?.direct) {
        outcome = 'no-master-token';
        this.logger.warn(
          `${prefix} skipped: no master token configured checked=${checked}`,
        );
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
          await Promise.all(
            pendings.slice(offset, offset + 10).map(async (tx) => {
              const queryStartedAt = Date.now();
              const transactionContext = `tx=${tx.id} domPaymentId=${tx.domPaymentId}`;
              this.logger.log(`${prefix} DOM request: ${transactionContext}`);
              try {
                const queryToken = opts?.domToken || domToken;
                if (!queryToken) {
                  this.logger.warn(
                    `${prefix} DOM request skipped: ${transactionContext} reason=no-token`,
                  );
                  return;
                }
                const detail = await this.gateway.getDomTransactionDetail(
                  queryToken,
                  tx.domPaymentId as string,
                );
                // ApiDomClient normaliza o detalhe como { order: { type, total, ... } }.
                const order = detail?.order;
                const status = order?.type ?? detail?.status;
                const durationMs = Date.now() - queryStartedAt;
                if (typeof status !== 'string' || !status) {
                  this.logger.warn(
                    `${prefix} DOM response: ${transactionContext} status=missing durationMs=${durationMs}`,
                  );
                  return;
                }
                this.logger.log(
                  `${prefix} DOM response: ${transactionContext} status=${status} durationMs=${durationMs}`,
                );
                domMap.set(tx.domPaymentId as string, {
                  id: tx.domPaymentId as string,
                  status,
                  amount: Number(order?.total ?? detail?.amount ?? 0),
                  liquid_amount: 0,
                  payment_method:
                    order?.type_payment ?? detail?.payment_method ?? '',
                  created_at: order?.date_register ?? detail?.created_at ?? '',
                });
              } catch (err) {
                this.logger.warn(
                  `${prefix} DOM request failed: ${transactionContext} durationMs=${Date.now() - queryStartedAt} error=${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }),
          );
        }
      }
      for (let page = 1; !opts?.direct && page <= 40; page++) {
        let txs: DomTransactionItem[] = [];
        try {
          const res = await this.gateway.listDomTransactions(
            domToken as string,
            {
              page,
              limit: 100,
              begin_date: beginDate,
              end_date: endDate,
            },
          );
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
        const dom =
          domMap.get(domPaymentId) ??
          (tx.domTransactionId ? domMap.get(tx.domTransactionId) : undefined) ??
          domMap.get(tx.id);
        const domStatus = String(dom?.status ?? '')
          .trim()
          .toLowerCase();

        const expectedStatus = PAID_STATUSES.has(domStatus)
          ? 'COMPLETED'
          : opts?.transactionId
            ? FAILURE_STATUSES[domStatus]
            : undefined;
        if (!dom || !expectedStatus) {
          this.logger.log(
            `${prefix} kept-pending: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${dom ? domStatus : 'not-found'} reason=${dom ? 'not-paid' : 'no-DOM-match'}`,
          );
          details.push({
            id: tx.id,
            domPaymentId,
            domStatus: dom ? domStatus : '(não encontrada na DOM)',
            action: 'kept-pending',
          });
          continue;
        }

        // A paginated list is only positive evidence when a matching row exists. It
        // never proves non-creation, even when the payment is absent from every page.
        const attempt = await this.prisma.paymentAttempt.findFirst({
          where: {
            transactionId: tx.id,
            provider: 'DOM',
            providerPaymentId: domPaymentId,
          },
        });
        if (attempt) {
          const correlated = await new PaymentAttemptsService(
            this.prisma,
          ).resolveCorrelated({
            transactionId: tx.id,
            provider: 'DOM',
            providerPaymentId: domPaymentId,
            externalReference: attempt.externalReference,
            outcome: expectedStatus === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED',
            evidence: {
              source: 'dom_reconciliation',
              providerStatus: domStatus,
              paymentId: domPaymentId,
            },
          });
          if (correlated.kind === 'incident') {
            this.logger.error(
              `${prefix} late-success incident: tx=${tx.id} attempt=${attempt.id}`,
            );
            details.push({
              id: tx.id,
              domPaymentId,
              domStatus,
              action: 'incident',
            });
            continue;
          }
          if (correlated.kind === 'not_found') {
            this.logger.warn(
              `${prefix} attempt identifiers changed: tx=${tx.id}`,
            );
            details.push({
              id: tx.id,
              domPaymentId,
              domStatus,
              action: 'kept-pending',
            });
            continue;
          }
        }

        // Reprocessa pelo caminho do webhook (credita carteira + SSE, idempotente via signature).
        // NÃO passamos liquid_amount de propósito: o handleTransaction usa o netAmount já gravado na
        // transação — mesmo valor de uma conclusão normal — em vez do líquido "enriquecido" da lista.
        const payload = {
          event: `reconcile.${domStatus}`,
          signature:
            expectedStatus === 'COMPLETED'
              ? `reconcile:${domPaymentId}`
              : `reconcile:${domPaymentId}:${domStatus}`,
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
        this.logger.log(
          `${prefix} webhook started: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${domStatus}`,
        );
        try {
          await this.webhook.execute(payload);
          const settled = await this.prisma.transaction.findUnique({
            where: { id: tx.id },
            select: { status: true },
          });
          if (settled?.status === 'COMPLETED') {
            completed++;
            this.logger.log(
              `${prefix} completed: tx=${tx.id} domPaymentId=${domPaymentId} durationMs=${Date.now() - webhookStartedAt}`,
            );
            details.push({
              id: tx.id,
              domPaymentId,
              domStatus,
              action: 'completed',
            });
          } else if (settled?.status === expectedStatus) {
            this.logger.log(
              `${prefix} settled: tx=${tx.id} domPaymentId=${domPaymentId} localStatus=${settled.status} durationMs=${Date.now() - webhookStartedAt}`,
            );
            details.push({
              id: tx.id,
              domPaymentId,
              domStatus,
              action: `settled:${settled.status}`,
            });
          } else {
            details.push({
              id: tx.id,
              domPaymentId,
              domStatus,
              action: 'kept-pending',
            });
            this.logger.warn(
              `${prefix} webhook did not complete: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${domStatus} localStatus=${settled?.status ?? 'missing'} durationMs=${Date.now() - webhookStartedAt}`,
            );
          }
        } catch (err) {
          this.logger.error(
            `${prefix} webhook failed: tx=${tx.id} domPaymentId=${domPaymentId} domStatus=${domStatus} durationMs=${Date.now() - webhookStartedAt} error=${err instanceof Error ? err.message : String(err)}`,
          );
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
      this.logger.error(
        `${prefix} run failed: error=${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    } finally {
      this.logger.log(
        `${prefix} ended: outcome=${outcome} checked=${checked} completed=${completed} durationMs=${Date.now() - startedAt}`,
      );
      this.activeRuns.delete(runKey);
    }
  }

  /**
   * Recupera transações órfãs: criadas como DRAFT, cuja cobrança na DOM pode ter sido criada
   * sem que a resposta chegasse (timeout/queda), ficando sem `domPaymentId`. Sem ele, nem o
   * webhook perdido nem o polling por PENDING conseguem liquidá-las.
   *
   * Casa pelo `cod_external` (= id da transação). Achou: anexa `domPaymentId`, promove a
   * PENDING e reprocessa pelo caminho normal. Não achou: só marca EXPIRED depois de a listagem
   * completa e de passar o prazo máximo do Pix; nunca apaga.
   */
  async recoverOrphanDrafts(): Promise<{ checked: number; recovered: number }> {
    const prefix = '[Reconcile][draft]';
    const runKey = 'draft:*';
    if (this.activeRuns.has(runKey)) return { checked: 0, recovered: 0 };
    this.activeRuns.set(runKey, { mode: 'draft', startedAt: Date.now() });
    let recovered = 0;
    try {
      const token = process.env.DOM_TOKEN;
      if (!token) return { checked: 0, recovered: 0 };
      const now = Date.now();
      const drafts = await this.prisma.transaction.findMany({
        where: {
          status: 'DRAFT',
          acquirer: 'DOM',
          domPaymentId: null,
          createdAt: { gte: new Date(now - ORPHAN_WINDOW_HOURS * 3_600_000) },
          updatedAt: { lte: new Date(now - ORPHAN_MIN_AGE_MINUTES * 60_000) },
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      if (drafts.length === 0) return { checked: 0, recovered: 0 };

      const domMap = new Map<string, DomTransactionItem>();
      const beginDate = this.toYmd(drafts[0].createdAt);
      const endDate = this.toYmd(new Date(now + 86_400_000));
      let listedAll = false;
      for (let page = 1; page <= 40; page++) {
        let txs: DomTransactionItem[];
        try {
          const res = await this.gateway.listDomTransactions(token, {
            page,
            limit: 100,
            begin_date: beginDate,
            end_date: endDate,
          });
          txs = res.transactions ?? [];
        } catch (err) {
          this.logger.warn(
            `${prefix} erro ao listar DOM (p.${page}): ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }
        for (const t of txs)
          if (t.cod_external) domMap.set(String(t.cod_external), t);
        if (txs.length < 100) {
          listedAll = true;
          break;
        }
      }

      for (const draft of drafts) {
        const dom = domMap.get(draft.id);
        if (!dom?.id) {
          if (
            listedAll &&
            now - draft.createdAt.getTime() >
              ORPHAN_EXPIRE_AFTER_HOURS * 3_600_000
          ) {
            await this.prisma.transaction.updateMany({
              where: { id: draft.id, status: 'DRAFT', domPaymentId: null },
              data: { status: 'EXPIRED' },
            });
            this.logger.warn(
              `${prefix} expired: tx=${draft.id} reason=no-DOM-match`,
            );
          }
          continue;
        }
        const attached = await this.prisma.transaction.updateMany({
          where: { id: draft.id, status: 'DRAFT', domPaymentId: null },
          data: {
            status: 'PENDING',
            domPaymentId: String(dom.id),
            externalPaymentId: String(dom.id),
            ...(dom.pix_qrcode ? { pixQrCode: dom.pix_qrcode } : {}),
            ...(dom.pix_content ? { pixContent: dom.pix_content } : {}),
            ...(dom.pix_expire ? { pixExpire: new Date(dom.pix_expire) } : {}),
          },
        });
        if (attached.count !== 1) continue;
        recovered++;
        this.logger.warn(
          `${prefix} recovered: tx=${draft.id} domPaymentId=${dom.id} domStatus=${dom.status}`,
        );
        await this.execute({
          transactionId: draft.id,
          direct: true,
          minAgeMinutes: 0,
        });
      }
      return { checked: drafts.length, recovered };
    } catch (err) {
      this.logger.error(
        `${prefix} erro: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { checked: 0, recovered };
    } finally {
      this.activeRuns.delete(runKey);
    }
  }

  /**
   * Sincronização periódica com a DOM (a cada 5 min): (1) liquida PENDING que o polling rápido
   * (30 min) já não cobre e cujo webhook se perdeu; (2) aponta pagamentos que existem na DOM mas
   * não têm transação local. Não cria transações financeiras a partir da DOM: faltam oferta,
   * taxas e tenant confiáveis, e creditar com dados incompletos seria pior que alertar.
   */
  async syncWithAcquirer(): Promise<{
    checked: number;
    completed: number;
    unmatched: number;
  }> {
    const prefix = '[Reconcile][sync]';
    const result = { checked: 0, completed: 0, unmatched: 0 };
    try {
      const settled = await this.execute({
        sinceHours: 72,
        minAgeMinutes: 5,
        limit: 500,
      });
      result.checked = settled.checked;
      result.completed = settled.completed;
    } catch (err) {
      this.logger.error(
        `${prefix} reconcile falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const token = process.env.DOM_TOKEN;
    if (!token) return result;
    try {
      const now = Date.now();
      const rows: DomTransactionItem[] = [];
      for (let page = 1; page <= 40; page++) {
        const res = await this.gateway.listDomTransactions(token, {
          page,
          limit: 100,
          begin_date: this.toYmd(new Date(now - 72 * 3_600_000)),
          end_date: this.toYmd(new Date(now + 86_400_000)),
        });
        const txs = res.transactions ?? [];
        rows.push(...txs);
        if (txs.length < 100) break;
      }
      const ids = rows.map((r) => String(r.id)).filter(Boolean);
      const refs = rows
        .map((r) => r.cod_external)
        .filter((v): v is string => !!v);
      if (ids.length === 0) return result;
      const known = await this.prisma.transaction.findMany({
        where: { OR: [{ domPaymentId: { in: ids } }, { id: { in: refs } }] },
        select: { id: true, domPaymentId: true },
      });
      const seen = new Set(
        known.flatMap(
          (t) => [t.id, t.domPaymentId].filter(Boolean) as string[],
        ),
      );
      for (const r of rows) {
        if (
          seen.has(String(r.id)) ||
          (r.cod_external && seen.has(r.cod_external))
        )
          continue;
        result.unmatched++;
        this.logger.warn(
          `${prefix} DOM sem transação local: domPaymentId=${r.id} cod_external=${r.cod_external ?? '-'} status=${r.status} amount=${r.amount} created_at=${r.created_at}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `${prefix} listagem DOM falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.logger.log(
      `${prefix} done: pendingChecked=${result.checked} completed=${result.completed} unmatched=${result.unmatched}`,
    );
    return result;
  }

  /** YYYY-MM-DD para o begin_date/end_date da listagem DOM. */
  private toYmd(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
