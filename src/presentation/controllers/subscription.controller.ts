import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListSubscribersQueryDto } from '../../application/dtos/subscription/list-subscribers.query.dto';
import { ListSubscribersUseCase } from '../../application/use-cases/subscription/list-subscribers.use-case';
import { CancelSubscriptionUseCase } from '../../application/use-cases/subscription/cancel-subscription.use-case';
import { GetSubscriptionDetailUseCase } from '../../application/use-cases/subscription/get-subscription-detail.use-case';
import { SubscriptionWebhookService } from '../../application/use-cases/subscription/subscription-webhook.service';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
@ApiTags('Assinantes')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly listSubscribers: ListSubscribersUseCase,
    private readonly cancel: CancelSubscriptionUseCase,
    private readonly getDetail: GetSubscriptionDetailUseCase,
    private readonly subscriptionWebhook: SubscriptionWebhookService,
  ) {}

  // ── Webhook público para recorrência (postback do gateway) ─────────────
  @Post('subscription/webhook')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Webhook de assinatura (postback do gateway)' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  async handleSubscriptionWebhook(
    @Body() body: Record<string, unknown>,
  ): Promise<{ status: string }> {
    this.logger.log(`[SubscriptionWebhook] Payload: ${JSON.stringify(body).substring(0, 500)}`);
    try {
      await this.subscriptionWebhook.handleWebhook(body);
    } catch (err) {
      this.logger.error(`[SubscriptionWebhook] Erro: ${err.message}`, err.stack);
    }
    return { status: 'ok' };
  }

  // ── Rotas autenticadas (/assinantes/*) ──────────────────────────────────

  @Get('assinantes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar assinantes' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [{ id: 'uuid-sub-1', status: 'ACTIVE', planoId: 'uuid-plan-1' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    },
  })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['page must not be less than 1'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async listSubscribersRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListSubscribersQueryDto,
  ): Promise<{ data: unknown; page: number; pageSize: number; total: number }> {
    return this.listSubscribers.execute({ userId: user?.sub ?? '', role: user?.role, query });
  }

  @Get('assinantes/subscription/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Detalhe da assinatura (DOM recurrence/subscriptions/:id)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  async getSubscriptionDetailRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.getDetail.execute({ userId: user?.sub ?? '', role: user?.role, id });
  }

  @Put('assinantes/subscription/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancelar assinatura' })
  @ApiResponse({ status: 200, schema: { example: { cancelled: true } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Assinatura não encontrada' } } })
  async cancelRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ cancelled: true }> {
    await this.cancel.execute({ userId: user?.sub ?? '', role: user?.role, id });
    return { cancelled: true };
  }
}
