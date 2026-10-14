import { Body, Controller, Headers, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PlatformContextService } from './platform-context.service';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';
import { ProcessWebhookUseCase } from '../../application/use-cases/webhook/process-webhook.use-case';
import { unsupportedCapability } from './platform-adapters';

@Controller('platforms/:tag/webhooks')
export class PlatformWebhookController {
  constructor(private readonly contexts: PlatformContextService, private readonly prisma: PrismaService, private readonly processor: ProcessWebhookUseCase) {}

  @Post(':acquirer') @HttpCode(200)
  async handle(@Param('tag') tag: string, @Param('acquirer') acquirer: string,
    @Headers('x-webhook-signature') signature: string, @Req() request: { rawBody?: Buffer }, @Body() body: any) {
    const platform = await this.contexts.resolve(tag);
    if (platform.acquirer !== acquirer.toUpperCase()) unsupportedCapability('webhooks.' + acquirer);
    const config = await this.prisma.platformIntegration.findUnique({ where: { platformId_key: { platformId: platform.id, key: 'WEBHOOK_SECRET' } } });
    if (!config?.encryptedValue) throw new UnauthorizedException('Webhook não configurado');
    const secret = decryptPlatformSecret(config.encryptedValue);
    const provided = platform.acquirer === 'FRENDZ' ? body?.token : signature;
    if (typeof provided !== 'string' || platform.acquirer === 'DOM' && !request.rawBody) throw new UnauthorizedException('Assinatura ou corpo ausente');
    const expected = platform.acquirer === 'FRENDZ' ? secret : createHmac('sha256', secret).update(request.rawBody!).digest('hex');
    const supplied = Buffer.from(provided); const computed = Buffer.from(expected);
    if (supplied.length !== computed.length || !timingSafeEqual(supplied, computed)) throw new UnauthorizedException('Assinatura inválida');
    const data = platform.acquirer === 'FRENDZ' ? body.transaction : body.data;
    const paymentId = String(platform.acquirer === 'FRENDZ' ? data?.id ?? '' : data?.paymentId ?? '');
    const transaction = paymentId ? await this.prisma.transaction.findFirst({ where: { acquirer: platform.acquirer, description: { contains: `[TENANT:${platform.tag}]` }, OR: [{ externalPaymentId: paymentId }, { domPaymentId: paymentId }] } }) : null;
    if (!transaction) throw new UnauthorizedException('Pagamento fora da plataforma');
    const status = String(body.status ?? data.status ?? '').toLowerCase();
    const normalized = ['approved', 'completed'].includes(status) ? 'paid' : ['refused', 'not_authorized'].includes(status) ? 'failed' : status;
    const eventId = createHash('sha256').update(`${platform.id}:${platform.acquirer}:${paymentId}:${normalized}`).digest('hex');
    await this.processor.execute({ transactionId: transaction.id, payload: { event: 'transaction', signature: eventId, data: { paymentId, status: normalized,
      amountWithoutAllFee: transaction.netAmount?.toNumber() ?? transaction.amount.toNumber(), acquirer: platform.acquirer } } });
    return { status: 'ok' };
  }
}
