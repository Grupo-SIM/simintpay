import { unsupportedCapability } from './platform-adapters';
import { Prisma } from '@prisma/client';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { NotFoundException } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  SetMetadata,
  Sse,
  StreamableFile,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformEventsService } from './platform-events.service';
import { PlatformSyncService } from './platform-sync.service';
import { PlatformFinanceService } from '../unified-platform/finance/platform-finance.service';
import { PlatformPaymentsService } from '../unified-platform/payments/platform-payments.service';
import { CreatePlatformPaymentDto } from '../unified-platform/payments/platform-payment.dto';
import { platformAdapter } from './platform-adapters';

type PlatformRequest = { platformContext: PlatformContext };
const Operation = (operation: string) =>
  SetMetadata('platform-operation', operation);

@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
export class PlatformOperationsController {
  constructor(
    private readonly finance: PlatformFinanceService,
    private readonly payments: PlatformPaymentsService,
    private readonly events: PlatformEventsService,
    private readonly syncService: PlatformSyncService,
    private readonly storage: StorageService,
  ) {}

  @Post('sync/owner-mirror')
  @Operation('sync:run')
  async ownerMirror(@Req() request: PlatformRequest) {
    if (!['ATLAS', 'REVALIDA'].includes(request.platformContext.tag))
      unsupportedCapability('sync.owner-mirror');
    const result = await this.finance.ownerMirror(request.platformContext);
    if (!result.success) return result;
    const { balance, ...data } = result;
    return {
      ...data,
      unit: 'cents',
      balanceScope: 'owner-wallet',
      balanceCents: new Prisma.Decimal(balance ?? 0).mul(100).toNumber(),
    };
  }

  @Get('capabilities')
  @Operation('reports:read')
  capabilities(@Req() request: PlatformRequest) {
    return platformAdapter(request.platformContext.tag);
  }

  @Get('payments/:paymentId')
  @Operation('payments:read')
  payment(
    @Req() request: PlatformRequest,
    @Param('paymentId') paymentId: string,
  ) {
    return this.payments.read(request.platformContext, paymentId);
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
    @Body() body: CreatePlatformPaymentDto,
  ) {
    return this.payments.create(request.platformContext, body);
  }

  @Post('finance/entries')
  @Operation('ledger:write')
  importEntry(
    @Req() request: PlatformRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.finance.importEntry(request.platformContext, body);
  }

  @Get('finance/config')
  @Operation('finance:read')
  config(@Req() request: PlatformRequest) {
    return this.finance.config(request.platformContext);
  }

  @Get('finance/withdrawals/:id')
  @Operation('finance:read')
  withdrawal(@Req() request: PlatformRequest, @Param('id') id: string) {
    return this.finance.withdrawal(request.platformContext, id);
  }

  @Get('finance/withdrawals/:id/receipt')
  @Operation('finance:read')
  async withdrawalReceipt(
    @Req() request: PlatformRequest,
    @Param('id') id: string,
  ) {
    const url = await this.finance.withdrawalReceiptRef(
      request.platformContext,
      id,
    );
    const out = await this.storage
      .getReceiptBufferByStoredUrl(url)
      .catch(() => {
        throw new NotFoundException(
          'Comprovante não disponível para este saque',
        );
      });
    const type = out.contentType.split(';')[0].trim().toLowerCase();
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(
        type,
      )
    )
      throw new NotFoundException('Comprovante não disponível para este saque');
    return new StreamableFile(out.buffer, {
      type,
      disposition: 'inline; filename="comprovante"',
    });
  }

  @Get('finance/balance')
  @Operation('finance:read')
  platformBalance(@Req() request: PlatformRequest) {
    return this.finance.platformBalance(request.platformContext);
  }

  @Get('finance/summary')
  @Operation('finance:read')
  summary(@Req() request: PlatformRequest) {
    return this.finance.summary(request.platformContext);
  }

  @Get('finance/machines')
  @Operation('finance:read')
  machines(
    @Req() request: PlatformRequest,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.finance.machines(request.platformContext, {
      page: Number(page),
      limit: Number(limit),
      startDate,
      endDate,
    });
  }

  @Get('finance/transactions')
  @Operation('finance:read')
  transactions(
    @Req() request: PlatformRequest,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    return this.finance.transactions(request.platformContext, {
      page: Number(page),
      limit: Number(limit),
      status,
    });
  }

  @Post('finance/withdrawals')
  @Operation('finance:withdraw')
  requestWithdrawal(
    @Req() request: PlatformRequest,
    @Body()
    body: { amountCents: number; pixKey: string; idempotencyKey: string },
  ) {
    return this.finance.requestWithdrawal(request.platformContext, body);
  }

  @Get('finance/withdrawals')
  @Operation('finance:read')
  withdrawals(
    @Req() request: PlatformRequest,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.finance.withdrawals(request.platformContext, {
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get('reports/dashboard/:view')
  @Operation('reports:read')
  dashboard(
    @Req() request: PlatformRequest,
    @Param('view') view: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('period') period?: string,
  ) {
    return this.finance.dashboard(
      request.platformContext,
      view,
      Number(page),
      Number(limit),
      period,
    );
  }

  @Get('reports')
  @Operation('reports:read')
  report(@Req() request: PlatformRequest) {
    return this.finance.report(request.platformContext);
  }

  @Sse('events')
  @Operation('events:read')
  eventStream(@Req() request: PlatformRequest) {
    return this.events.messages(request.platformContext.tag);
  }

  @Post('sync')
  @Operation('sync:run')
  sync(@Req() request: PlatformRequest) {
    return this.syncService.sync(request.platformContext);
  }

  @Post('maintenance/:operation')
  @Operation('maintenance:run')
  async maintenance(
    @Req() request: PlatformRequest,
    @Param('operation') operation: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.finance.maintenance(request.platformContext, operation, body);
  }
}
