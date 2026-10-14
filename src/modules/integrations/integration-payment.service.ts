import { resolveLegacyMerchantPlatform } from './legacy-merchant-platform';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { IntegrationFinanceService } from './integration-finance.service';
import { LegacyPlatformPaymentCore } from '../unified-platform/payments/legacy-platform-payment.core';
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import { getModuleConfig } from '../module.registry';
import { CheckoutPixDto } from '../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../renovada/dtos/checkout-credit-card.dto';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

@Injectable()
export class IntegrationPaymentService {
  constructor(private readonly prisma: PrismaService, private readonly finance: IntegrationFinanceService, private readonly reconcile: ReconcilePendingTransactionsUseCase) {}

  platform(integrationKey: string) { return resolveLegacyMerchantPlatform(this.prisma, integrationKey); }

  private async core(integrationKey: string, externalMerchantId: string) {
    const platform = await this.platform(integrationKey);
    const merchant = await this.finance.merchant(integrationKey, externalMerchantId);
    const config = getModuleConfig(platform.tag);
    if (!config) throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'merchants.configuration' });
    return { merchant, core: new LegacyPlatformPaymentCore(this.prisma, this.reconcile, platform.tag, config, merchant.id) };
  }
  async pix(integrationKey: string, externalMerchantId: string, body: CheckoutPixDto) { const { merchant, core } = await this.core(integrationKey, externalMerchantId); return core.createPaymentPix(merchant.userId, body); }
  async card(integrationKey: string, externalMerchantId: string, body: CheckoutCreditCardDto) { const { merchant, core } = await this.core(integrationKey, externalMerchantId); return core.createPaymentCreditCard(merchant.userId, body); }
  async status(integrationKey: string, externalMerchantId: string, paymentId: string) {
    const platform = await this.platform(integrationKey);
    const merchant = await this.finance.merchant(integrationKey, externalMerchantId);
    if (platform.acquirer !== 'DOM') throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'merchants.reconciliation' });
    return this.reconcile.reconcilePayment(paymentId, merchant.userId, getPlatformIntegrationValue(platform.tag, 'DOM_TOKEN') ?? undefined);
  }
}
