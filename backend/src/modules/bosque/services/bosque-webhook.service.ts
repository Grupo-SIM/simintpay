import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ProcessWebhookUseCase } from '../../../application/use-cases/webhook/process-webhook.use-case';
import { PlatformContextService } from '../../platform-core/platform-context.service';
import { PlatformWebhookSettlement } from '../../platform-core/platform-webhook-settlement';
import { unsupportedCapability } from '../../platform-core/platform-adapters';

@Injectable()
export class BosqueWebhookService {
  constructor(private readonly prisma: PrismaService, private readonly modules: ModuleRef) {}
  async processWebhook(body: unknown): Promise<void> {
    const platform = await new PlatformContextService(this.prisma).resolve('BOSQUE');
    if (platform.acquirer !== 'DOM') unsupportedCapability('webhooks.DOM');
    await new PlatformWebhookSettlement(this.prisma, this.modules.get(ProcessWebhookUseCase, { strict: false })).apply(platform, body, false);
  }
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = process.env.DOM_WEBHOOK_SECRET;
    // Existing anonymous alias contract only. Canonical ingress always requires scoped secret.
    if (!secret) return true;
    if (typeof signature !== 'string') return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'));
    const supplied = Buffer.from(signature);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}
