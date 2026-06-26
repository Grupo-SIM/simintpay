import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  QUEUE_SERVICE,
  type IQueueService,
} from '../../core/services/queue.interface';
import { QueueNames } from '../../infrastructure/queue/queue-names';

/**
 * ──────────────────────────────────────────────────────────────────────────
 * Postback (webhook) da Frendz.
 *
 * A Frendz envia um POST para a `URL de Postback` configurada no painel
 * (Integrações → Webhooks) sempre que o status de uma transação muda.
 *
 * Estratégia: em vez de duplicar a lógica de crédito de carteira, este
 * controller TRADUZ o payload da Frendz para o MESMO formato canônico que o
 * webhook da DOM já produz e publica na MESMA fila (WEBHOOK_EVENTS). O
 * ProcessWebhookUseCase então localiza a transação (por externalPaymentId,
 * via fallback no repositório) e credita a carteira — caminho único e testado.
 *
 * Formato real do postback Frendz (campos usados):
 *   {
 *     token, event:"transaction", status:"paid"|"refunded"|..., method:"pix",
 *     paid_at, refunded_at,
 *     customer: {...},
 *     transaction: { id, status, amount, net_amount, pix:{code,...} }
 *   }
 * ──────────────────────────────────────────────────────────────────────────
 */
@Controller('webhook/frendz')
@ApiTags('Webhook')
export class FrendzWebhookController {
  private readonly logger = new Logger(FrendzWebhookController.name);

  constructor(@Inject(QUEUE_SERVICE) private readonly queue: IQueueService) {}

  @Post()
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Receber postback (webhook) da Frendz' })
  async handle(
    @Body() body: Record<string, unknown>,
    @Headers('x-webhook-token') tokenHeader: string | undefined,
  ): Promise<{ status: string }> {
    this.verifyAuthenticity(body, tokenHeader);

    const canonical = this.toCanonicalPayload(body);
    if (!canonical) {
      // Postback que não conseguimos mapear (sem id ou status). Respondemos 200
      // para a Frendz não reenviar em loop, mas logamos para diagnóstico.
      this.logger.warn(
        `[Frendz webhook] payload não mapeável: ${JSON.stringify(body).slice(0, 500)}`,
      );
      return { status: 'ignored' };
    }

    await this.queue.publish(QueueNames.WEBHOOK_EVENTS, canonical);
    return { status: 'ok' };
  }

  /**
   * Confere a origem do postback. A Frendz inclui um `token` no corpo; quando
   * `FRENDZ_WEBHOOK_TOKEN` está definido, exigimos que ele bata (no corpo ou no
   * header `x-webhook-token`). Sem a env configurada, não bloqueia — apenas
   * loga — para não travar a integração antes do segredo ser provisionado.
   */
  private verifyAuthenticity(
    body: Record<string, unknown>,
    tokenHeader: string | undefined,
  ): void {
    const expected = process.env.FRENDZ_WEBHOOK_TOKEN;
    if (!expected) {
      this.logger.warn(
        '[Frendz webhook] FRENDZ_WEBHOOK_TOKEN não configurado — aceitando sem validar origem',
      );
      return;
    }
    const provided =
      tokenHeader ??
      (typeof body?.token === 'string' ? (body.token as string) : undefined);
    if (provided !== expected) {
      throw new UnauthorizedException('Frendz webhook: token inválido');
    }
  }

  /** Mapeia status da Frendz → status canônico consumido pelo ProcessWebhookUseCase. */
  private mapStatus(frendzStatus: string | null | undefined): string | null {
    switch ((frendzStatus ?? '').toLowerCase()) {
      case 'paid':
        return 'paid';
      case 'refunded':
        return 'refunded';
      case 'chargeback':
        return 'chargeback';
      case 'in_protest':
      case 'in_mediation':
      case 'in_dispute':
        return 'in_mediation';
      case 'pending':
      case 'waiting_payment':
        return 'pending';
      case 'canceled':
      case 'cancelled':
      case 'refused':
      case 'failed':
        return 'failed';
      default:
        return null;
    }
  }

  private asObject(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  }

  private asString(v: unknown): string | null {
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  }

  private asNumber(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
      return Number(v);
    return null;
  }

  /**
   * Traduz o corpo da Frendz para o formato que parseDomPayload espera:
   *   { event, signature, data: { paymentId, status, amountWithoutAllFee, ... } }
   * - paymentId  ← transaction.id  (casa com Transaction.externalPaymentId)
   * - status     ← mapStatus(status da raiz)
   * - amountWithoutAllFee ← transaction.net_amount em REAIS (Frendz manda centavos)
   */
  private toCanonicalPayload(
    body: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const tx = this.asObject(body.transaction);
    const paymentId =
      this.asString(tx?.id) ??
      this.asString(body.id) ??
      this.asString(tx?.hash);
    if (!paymentId) return null;

    // Status do pagamento: prioriza o da raiz (é o "Status do Pagamento" do
    // painel); cai para o de transaction se necessário.
    const status =
      this.mapStatus(this.asString(body.status)) ??
      this.mapStatus(this.asString(tx?.status));
    if (!status) return null;

    const netCents = this.asNumber(tx?.net_amount);
    const grossCents = this.asNumber(tx?.amount);
    const cents = netCents ?? grossCents ?? 0;
    const amountWithoutAllFee = Number((cents / 100).toFixed(2)); // centavos → reais

    // `signature` é exigido por parseDomPayload como id único do evento; usamos
    // o token do evento ou o próprio paymentId.
    const signature = this.asString(body.token) ?? `frendz_${paymentId}`;

    return {
      event: this.asString(body.event) ?? 'transaction',
      signature,
      data: {
        paymentId,
        status,
        amountWithoutAllFee,
        acquirer: 'FRENDZ',
        method: this.asString(body.method) ?? 'pix',
        paidAt: this.asString(body.paid_at),
        refundedAt: this.asString(body.refunded_at),
      },
    };
  }
}
