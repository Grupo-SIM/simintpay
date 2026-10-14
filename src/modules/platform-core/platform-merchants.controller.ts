import { Body, Controller, Get, Param, Post, Put, Req, SetMetadata, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformMerchantsService } from './platform-merchants.service';
import { CreatePlatformPaymentDto } from '../unified-platform/payments/platform-payment.dto';

const Operation = (operation: string) => SetMetadata('platform-operation', operation);
type PlatformRequest = { platformContext: PlatformContext };
@Controller('platforms/:tag/merchants/:externalMerchantId')
@UseGuards(PlatformAuthGuard)
export class PlatformMerchantsController {
  constructor(private readonly merchants: PlatformMerchantsService) {}
  @Put() @Operation('merchants:manage')
  provision(@Req() request: PlatformRequest, @Param('externalMerchantId') id: string, @Body() body: { cnpj: string; legalName: string }) { return this.merchants.provision(request.platformContext, id, body); }
  @Post('payments') @Operation('payments:create')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  create(@Req() request: PlatformRequest, @Param('externalMerchantId') id: string, @Body() body: CreatePlatformPaymentDto) { return this.merchants.createPayment(request.platformContext, id, body); }
  @Get('payments/:paymentId') @Operation('payments:read')
  payment(@Req() request: PlatformRequest, @Param('externalMerchantId') id: string, @Param('paymentId') paymentId: string) { return this.merchants.payment(request.platformContext, id, paymentId); }
  @Get('finance/summary') @Operation('finance:read')
  summary(@Req() request: PlatformRequest, @Param('externalMerchantId') id: string) { return this.merchants.summary(request.platformContext, id); }
  @Get('finance/withdrawals') @Operation('finance:read')
  withdrawals(@Req() request: PlatformRequest, @Param('externalMerchantId') id: string) { return this.merchants.withdrawals(request.platformContext, id); }
  @Post('finance/withdrawals') @Operation('finance:withdraw')
  withdraw(@Req() request: PlatformRequest, @Param('externalMerchantId') id: string, @Body() body: { amountCents: number; pixKey: string; idempotencyKey: string }) { return this.merchants.withdraw(request.platformContext, id, body); }
}
