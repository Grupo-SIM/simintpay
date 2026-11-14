import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  SetMetadata,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { MerchantProvisionInput } from './platform-merchant-provisioning';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformMerchantsService } from './platform-merchants.service';
import { CreatePlatformPaymentDto } from '../unified-platform/payments/platform-payment.dto';

const Operation = (operation: string) =>
  SetMetadata('platform-operation', operation);
type PlatformRequest = { platformContext: PlatformContext };
@Controller('platforms/:tag/merchants/:externalMerchantId')
@UseGuards(PlatformAuthGuard)
export class PlatformMerchantsController {
  constructor(private readonly merchants: PlatformMerchantsService) {}
  @Put()
  @Operation('merchants:manage')
  provision(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Body() body: MerchantProvisionInput,
  ) {
    return this.merchants.provision(request.platformContext, id, body);
  }
  @Post('payments')
  @Operation('payments:create')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  create(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Body() body: CreatePlatformPaymentDto,
  ) {
    return this.merchants.createPayment(request.platformContext, id, body);
  }
  @Get('payment-attempts/:key')
  @Operation('payments:read')
  attempt(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Param('key') key: string,
  ) {
    return this.merchants.paymentAttempt(request.platformContext, id, key);
  }
  @Get('payments/:paymentId')
  @Operation('payments:read')
  payment(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.merchants.payment(request.platformContext, id, paymentId);
  }
  @Get('finance/summary')
  @Operation('finance:read')
  summary(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
  ) {
    return this.merchants.summary(request.platformContext, id);
  }
  @Get('finance/transactions')
  @Operation('finance:read')
  transactions(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('description') description?: string,
  ) {
    return this.merchants.transactions(request.platformContext, id, {
      page: Number(page),
      limit: Number(limit),
      startDate,
      endDate,
      status,
      description,
    });
  }
  @Get('finance/fees')
  @Operation('finance:read')
  fees(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
  ) {
    return this.merchants.fees(request.platformContext, id);
  }
  @Post('finance/entries')
  @Operation('ledger:write')
  importEntry(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.merchants.importEntry(request.platformContext, id, body);
  }
  @Get('finance/acquirer-costs')
  @Operation('finance:read')
  acquirerCosts(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
  ) {
    return this.merchants.acquirerCosts(request.platformContext, id);
  }
  @Get('finance/withdrawals')
  @Operation('finance:read')
  withdrawals(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.merchants.withdrawals(
      request.platformContext,
      id,
      Number(page),
      Number(limit),
    );
  }
  @Get('finance/withdrawals/:withdrawalId')
  @Operation('finance:read')
  withdrawal(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Param('withdrawalId') withdrawalId: string,
  ) {
    return this.merchants.withdrawal(request.platformContext, id, withdrawalId);
  }
  @Post('finance/withdrawals/quote')
  @Operation('finance:read')
  quote(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Body() body: { amountCents: number },
  ) {
    return this.merchants.quote(request.platformContext, id, body.amountCents);
  }
  @Post('finance/reconciliation/payments')
  @Operation('sync:run')
  reconcile(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Body() body: { paymentIds: string[]; dryRun?: boolean },
  ) {
    return this.merchants.reconcile(
      request.platformContext,
      id,
      body.paymentIds,
      body.dryRun ?? true,
    );
  }
  @Post('finance/withdrawals')
  @Operation('finance:withdraw')
  withdraw(
    @Req() request: PlatformRequest,
    @Param('externalMerchantId') id: string,
    @Body()
    body: { amountCents: number; pixKey: string; idempotencyKey: string },
  ) {
    return this.merchants.withdraw(request.platformContext, id, body);
  }
}
