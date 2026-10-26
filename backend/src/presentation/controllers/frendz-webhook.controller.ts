import { legacyFrendzWebhookPayload } from '../../modules/platform-core/platform-webhook.adapter';
import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
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
        '[Frendz webhook] payload não mapeável',
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
    const expected = (getPlatformIntegrationValue('FRENDZ', 'WEBHOOK_SECRET') ?? undefined);
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

  private toCanonicalPayload(body: Record<string, unknown>) { return legacyFrendzWebhookPayload(body); }
}
