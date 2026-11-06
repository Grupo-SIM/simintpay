import { deliveryAllocation } from './delivery-payment-allocation';
import {
  IntegrationPixCheckoutDto,
  IntegrationCardCheckoutDto,
  type DeliveryAllocationDto,
} from './integration-checkout.dto';
import { PlatformPaymentLookup } from '../unified-platform/payments/platform-payment-lookup';
import { resolveLegacyMerchantPlatform } from './legacy-merchant-platform';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { IntegrationFinanceService } from './integration-finance.service';
import { LegacyPlatformPaymentCore } from '../unified-platform/payments/legacy-platform-payment.core';
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';
import { getModuleConfig } from '../module.registry';

@Injectable()
export class IntegrationPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: IntegrationFinanceService,
    private readonly reconcile: ReconcilePendingTransactionsUseCase,
  ) {}

  platform(integrationKey: string) {
    return resolveLegacyMerchantPlatform(this.prisma, integrationKey);
  }

  private async core(
    integrationKey: string,
    externalMerchantId: string,
    inputAllocation?: DeliveryAllocationDto,
  ) {
    const allocation = deliveryAllocation(integrationKey, inputAllocation);
    const platform = await this.platform(integrationKey);
    const merchant = await this.finance.merchant(
      integrationKey,
      externalMerchantId,
    );
    const config = getModuleConfig(platform.tag);
    if (!config)
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: 'merchants.configuration',
      });
    return {
      merchant,
      core: new LegacyPlatformPaymentCore(
        this.prisma,
        this.reconcile,
        platform.tag,
        config,
        merchant.id,
        allocation,
      ),
    };
  }
  async pix(
    integrationKey: string,
    externalMerchantId: string,
    body: IntegrationPixCheckoutDto,
  ) {
    const { merchant, core } = await this.core(
      integrationKey,
      externalMerchantId,
      body.allocation,
    );
    return core.createPaymentPix(merchant.userId, body);
  }
  async card(
    integrationKey: string,
    externalMerchantId: string,
    body: IntegrationCardCheckoutDto,
  ) {
    const { merchant, core } = await this.core(
      integrationKey,
      externalMerchantId,
      body.allocation,
    );
    return core.createPaymentCreditCard(merchant.userId, body);
  }
  async status(
    integrationKey: string,
    externalMerchantId: string,
    paymentId: string,
  ) {
    const platform = await this.platform(integrationKey);
    const merchant = await this.finance.merchant(
      integrationKey,
      externalMerchantId,
    );
    if (platform.acquirer !== 'DOM')
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: 'merchants.reconciliation',
      });
    const payment = await new PlatformPaymentLookup(this.prisma).find(
      { id: platform.id, tag: platform.tag, ownerUserId: platform.ownerUserId },
      paymentId,
      merchant.userId,
    );
    if (!payment) return { paymentId, status: 'NOT_FOUND' };
    const token = process.env.DOM_TOKEN;
    if (!token)
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: 'merchants.reconciliation.configuration',
      });
    return this.reconcile.reconcilePayment(paymentId, merchant.userId, token);
  }
}
