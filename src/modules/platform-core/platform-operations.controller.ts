import { Body, Controller, Get, Param, Post, Query, Req, SetMetadata, Sse, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformEventsService } from './platform-events.service';
import { PlatformSyncService } from './platform-sync.service';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { PlatformPaymentsService } from '../unified-platform/payments/platform-payments.service';
import { CreatePlatformPaymentDto } from '../unified-platform/payments/platform-payment.dto';
import { platformAdapter } from './platform-adapters';

type PlatformRequest = { platformContext: PlatformContext };
const Operation = (operation: string) => SetMetadata('platform-operation', operation);

@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
export class PlatformOperationsController {
  constructor(private readonly finance: PlatformFinanceService, private readonly payments: PlatformPaymentsService,
    private readonly events: PlatformEventsService, private readonly syncService: PlatformSyncService) {}

  @Get('capabilities') @Operation('reports:read')
  capabilities(@Req() request: PlatformRequest) { return platformAdapter(request.platformContext.tag); }

  @Get('payments/:paymentId') @Operation('payments:read')
  payment(@Req() request: PlatformRequest, @Param('paymentId') paymentId: string) { return this.payments.read(request.platformContext, paymentId); }

  @Post('payments') @Operation('payments:create')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  create(@Req() request: PlatformRequest, @Body() body: CreatePlatformPaymentDto) { return this.payments.create(request.platformContext, body); }

  @Post('finance/entries') @Operation('ledger:write')
  importEntry(@Req() request: PlatformRequest, @Body() body: Record<string, unknown>) {
    return this.finance.importEntry(request.platformContext, body);
  }

  @Get('finance/summary') @Operation('finance:read')
  summary(@Req() request: PlatformRequest) { return this.finance.summary(request.platformContext); }

  @Get('finance/transactions') @Operation('finance:read')
  transactions(@Req() request: PlatformRequest, @Query('page') page = '1', @Query('limit') limit = '20', @Query('status') status?: string) {
    return this.finance.transactions(request.platformContext, { page: Number(page), limit: Number(limit), status });
  }

  @Post('finance/withdrawals') @Operation('finance:withdraw')
  requestWithdrawal(@Req() request: PlatformRequest, @Body() body: { amountCents: number; pixKey: string; idempotencyKey: string }) {
    return this.finance.requestWithdrawal(request.platformContext, body);
  }

  @Get('finance/withdrawals') @Operation('finance:read')
  withdrawals(@Req() request: PlatformRequest, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.finance.withdrawals(request.platformContext, { page: Number(page), limit: Number(limit) });
  }

  @Get('reports') @Operation('reports:read')
  report(@Req() request: PlatformRequest) { return this.finance.report(request.platformContext); }

  @Sse('events') @Operation('events:read')
  eventStream(@Req() request: PlatformRequest) { return this.events.messages(request.platformContext.tag); }

  @Post('sync') @Operation('sync:run')
  sync(@Req() request: PlatformRequest) { return this.syncService.sync(request.platformContext); }

  @Post('maintenance/:operation') @Operation('maintenance:run')
  async maintenance(@Req() request: PlatformRequest, @Param('operation') operation: string, @Body() body: Record<string, unknown>) {
    return this.finance.maintenance(request.platformContext, operation, body);
  }
}
