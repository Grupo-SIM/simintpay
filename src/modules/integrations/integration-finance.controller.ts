import { ProvisionDeliveryOwnerService } from './provision-delivery-owner.service';
import { ProvisionDeliveryOwnerDto } from './provision-delivery-owner.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { Body, Controller, Get, Headers, Param, Post, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { IntegrationPaymentService } from './integration-payment.service';
import { CheckoutPixDto } from '../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../renovada/dtos/checkout-credit-card.dto';
import { IntegrationFinanceService } from './integration-finance.service';

@Controller('internal/integrations/:integrationKey/merchants/:externalMerchantId')
export class IntegrationFinanceController {
  constructor(
    private readonly owners: ProvisionDeliveryOwnerService,
    private readonly finance: IntegrationFinanceService,
    private readonly payments: IntegrationPaymentService,
  ) {}

  private auth(token?: string) { this.finance.assertToken(token); }

  @Put('owner')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async owner(@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: ProvisionDeliveryOwnerDto, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.owners.execute(params.integrationKey, params.externalMerchantId, body);
  }

  @Put()
  async provision(@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: { cnpj: string; legalName: string }, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.finance.provision(params.integrationKey, params.externalMerchantId, body);
  }

  @Post('payments/pix')
  async pix(@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: CheckoutPixDto, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.payments.pix(params.integrationKey, params.externalMerchantId, body);
  }

  @Post('payments/credit-card')
  async card(@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: CheckoutCreditCardDto, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.payments.card(params.integrationKey, params.externalMerchantId, body);
  }

  @Get('payments/:paymentId')
  @SkipThrottle()
  async paymentStatus(@Param() params: { integrationKey: string; externalMerchantId: string; paymentId: string }, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.payments.status(params.integrationKey, params.externalMerchantId, params.paymentId);
  }

  @Get('finance/summary')
  async summary(@Param() params: { integrationKey: string; externalMerchantId: string }, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.finance.summary(params.integrationKey, params.externalMerchantId);
  }

  @Post('finance/withdrawals/quote')
  async quote(@Param('integrationKey') integrationKey: string, @Body() body: { grossAmountCents: number }, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.finance.quote(body.grossAmountCents, (await this.payments.platform(integrationKey)).tag);
  }

  @Post('finance/withdrawals')
  async withdraw(@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: { grossAmountCents: number; pixKey: string; requestId: string }, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.finance.requestWithdrawal(params.integrationKey, params.externalMerchantId, body);
  }

  @Get('finance/withdrawals')
  async withdrawals(@Param() params: { integrationKey: string; externalMerchantId: string }, @Query('page') page = '1', @Query('pageSize') pageSize = '10', @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.finance.listWithdrawals(params.integrationKey, params.externalMerchantId, Number(page), Number(pageSize));
  }

  @Get('finance/withdrawals/:withdrawalId')
  async withdrawal(@Param() params: { integrationKey: string; externalMerchantId: string; withdrawalId: string }, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.finance.getWithdrawal(params.integrationKey, params.externalMerchantId, params.withdrawalId);
  }

  @Post('finance/reconciliation/payments')
  async reconcile(@Param() params: { integrationKey: string; externalMerchantId: string }, @Body() body: { dryRun?: boolean; paymentIds: string[] }, @Headers('x-internal-token') token?: string) {
    this.auth(token);
    return this.finance.reconcilePayments(params.integrationKey, params.externalMerchantId, body.paymentIds ?? [], body.dryRun !== false);
  }
}
