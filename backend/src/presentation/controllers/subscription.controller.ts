import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put, Query, UseGuards, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BillingService } from '../../application/use-cases/billing/billing.service';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListSubscribersQueryDto } from '../../application/dtos/subscription/list-subscribers.query.dto';
import { ListSubscribersUseCase } from '../../application/use-cases/subscription/list-subscribers.use-case';
import { CancelSubscriptionUseCase } from '../../application/use-cases/subscription/cancel-subscription.use-case';
import { PauseSubscriptionUseCase } from '../../application/use-cases/subscription/pause-subscription.use-case';
import { ResumeSubscriptionUseCase } from '../../application/use-cases/subscription/resume-subscription.use-case';
import { GetSubscriptionDetailUseCase } from '../../application/use-cases/subscription/get-subscription-detail.use-case';
import { RemoveInactiveSubscriptionHistoryUseCase } from '../../application/use-cases/subscription/remove-inactive-subscription-history.use-case';
import { SubscriptionWebhookService } from '../../application/use-cases/subscription/subscription-webhook.service';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
@ApiTags('Assinantes')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly listSubscribers: ListSubscribersUseCase,
    private readonly cancel: CancelSubscriptionUseCase,
    private readonly pause: PauseSubscriptionUseCase,
    private readonly resume: ResumeSubscriptionUseCase,
    private readonly getDetail: GetSubscriptionDetailUseCase,
    private readonly removeInactiveHistory: RemoveInactiveSubscriptionHistoryUseCase,
    private readonly subscriptionWebhook: SubscriptionWebhookService,
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly jwt: JwtService,
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
    const data = body.data as Record<string, unknown> | undefined;
    const relations = data?.relations as Record<string, unknown> | undefined;
    const event = String(body.event ?? '').replace(/\s+/g, '').toUpperCase();
    const subscriptionId = typeof relations?.id_subscriber === 'string'
      ? relations.id_subscriber
      : event.startsWith('SIGNATURE-') && typeof data?.id === 'string'
        ? data.id
        : undefined;
    const signature = typeof body.signature === 'string' ? body.signature : undefined;
    if (!subscriptionId || !signature) throw new UnauthorizedException('Webhook DOM inválido');
    const token = await this.billing.getDomWebhookToken(subscriptionId) ?? process.env.DOM_TOKEN;
    if (!token) throw new UnauthorizedException('Webhook DOM não configurado');
    try {
      await this.jwt.verifyAsync(signature, { secret: token, algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Assinatura DOM inválida');
    }
    const paymentId = typeof data?.id === 'string' ? data.id : undefined;
    const amount = typeof data?.amount === 'number' ? data.amount / 100 : undefined;
    const mapped = event.includes('INVOICE-PAID') || event === 'CHARGE-APPROVED'
      ? 'PAID' : event.includes('INVOICE-FAILED') || event === 'CHARGE-NOT_AUTHORIZED' || event === 'CHARGE-EXPIRE'
        ? 'FAILED' : event === 'SIGNATURE-CANCELLED' ? 'CANCELLED' : undefined;
    if (mapped) await this.billing.applyWorkspacePaymentEvent({ subscriptionId, eventKey: `dom:${signature}`, event: mapped, paymentId, amount });
    await this.subscriptionWebhook.handleWebhook(body);
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

  @Delete('assinantes/subscription/:id/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ocultar assinatura inativa do histórico (somente admin master)' })
  @ApiResponse({ status: 200, schema: { example: { removed: true } } })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  async removeInactiveHistoryRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    return this.removeInactiveHistory.execute({
      userId: user?.sub ?? '',
      domSubscriptionId: id,
    });
  }

  /** Pausa a assinatura CC de um cliente pelo e-mail (usado pelo admin-pagatg).
   *  IMPORTANTE: declarado ANTES de /subscription/:id/* para evitar captura de "by-email" como :id. */
  @Put('assinantes/subscription/by-email/pause')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pausar assinatura CC pelo e-mail do cliente' })
  @ApiBody({ schema: { example: { customerEmail: 'cliente@example.com' } } })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async pauseByEmail(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: { customerEmail: string },
  ) {
    if (!body?.customerEmail) throw new BadRequestException('customerEmail é obrigatório');

    const order = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { customerEmail: body.customerEmail, domSubscriptionId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { domSubscriptionId: true },
    });
    if (!order?.domSubscriptionId) {
      throw new NotFoundException(`Nenhuma assinatura encontrada para ${body.customerEmail}`);
    }

    return this.pause.execute({
      userId: user?.sub ?? '',
      role: user?.role,
      domSubscriptionId: order.domSubscriptionId,
    });
  }

  /** Retoma a assinatura CC pausada de um cliente pelo e-mail (usado pelo admin-pagatg). */
  @Put('assinantes/subscription/by-email/resume')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retomar assinatura CC pausada pelo e-mail do cliente' })
  @ApiBody({ schema: { example: { customerEmail: 'cliente@example.com' } } })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async resumeByEmail(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: { customerEmail: string },
  ) {
    if (!body?.customerEmail) throw new BadRequestException('customerEmail é obrigatório');

    const order = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { customerEmail: body.customerEmail, domSubscriptionId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { domSubscriptionId: true },
    });
    if (!order?.domSubscriptionId) {
      throw new NotFoundException(`Nenhuma assinatura encontrada para ${body.customerEmail}`);
    }

    // Verifica se há uma pausa registrada para este domSubscriptionId
    const pause = await this.prisma.subscriptionPause.findUnique({
      where: { domSubscriptionId: order.domSubscriptionId },
    });
    if (!pause) {
      throw new NotFoundException(`Esta assinatura não está pausada.`);
    }

    return this.resume.execute({
      userId: user?.sub ?? '',
      role: user?.role,
      domSubscriptionId: order.domSubscriptionId,
    });
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

  @Put('assinantes/subscription/:id/pause')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pausar assinatura — cancela na DOM e guarda dias restantes' })
  @ApiResponse({ status: 200, schema: { example: { remainingDays: 25, pausedAt: '2026-04-12T00:00:00.000Z', warningMessage: '...' } } })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 404 })
  async pauseRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ remainingDays: number; pausedAt: string; warningMessage: string }> {
    return this.pause.execute({
      userId: user?.sub ?? '',
      role: user?.role,
      domSubscriptionId: id,
    });
  }

  @Put('assinantes/subscription/:id/resume')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retomar assinatura pausada — calcula nova expiresAt com os dias restantes' })
  @ApiResponse({ status: 200, schema: { example: { newExpiresAt: '2026-05-07T00:00:00.000Z', remainingDays: 25 } } })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 404 })
  async resumeRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ newExpiresAt: string; remainingDays: number }> {
    return this.resume.execute({
      userId: user?.sub ?? '',
      role: user?.role,
      domSubscriptionId: id,
    });
  }
}
