import { UpdatePixCreditPlanDto } from '../../application/dtos/pix-plan/update-pix-credit-plan.dto';
import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  MessageEvent,
  Param,
  Post,
  Patch,
  Query,
  Res,
  Sse,
  UnauthorizedException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Observable, merge, timer, NEVER } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';
import { PixPlanEventsService } from '../../application/services/pix-plan-events.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PixPlanCheckoutDto } from '../../application/dtos/pix-plan/pix-plan-checkout.dto';
import { PixPlanCheckoutByCodeDto } from '../../application/dtos/pix-plan/pix-plan-checkout-by-code.dto';
import { CreatePixCreditPlanDto } from '../../application/dtos/pix-plan/create-pix-credit-plan.dto';
import { PixPlanService } from '../../application/use-cases/pix-plan/pix-plan.service';

@Controller('payments')
@ApiTags('PIX Plan')
export class PixPlanController {
  constructor(private readonly pixPlanService: PixPlanService) {}

  // ── Rotas públicas (sem autenticação) ──────────────────────────────────────

  @Get('pix-plan/link-code/:code')
  @ApiOperation({ summary: 'Obter link-code PIX-PLAN' })
  @ApiParam({ name: 'code', description: 'Código do link PIX-PLAN' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPixPlanLinkCode(@Param('code') code: string) {
    return this.pixPlanService.getPixPlanLinkCode(code);
  }

  @Get('pix-plan/link-code-details/:code/checkout')
  @ApiOperation({ summary: 'Obter detalhes de link code PIX-PLAN para checkout' })
  @ApiParam({ name: 'code', description: 'Código do link PIX-PLAN' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPixPlanLinkCodeDetailsForCheckout(@Param('code') code: string) {
    return this.pixPlanService.getPixPlanLinkCodeDetailsForCheckout(code);
  }

  // ── Rotas autenticadas ─────────────────────────────────────────────────────

  @Post('pix-plan/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar pagamento PIX para plano com crédito de dias' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 401 })
  async createPixPlanCheckout(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: PixPlanCheckoutDto,
  ) {
    return this.pixPlanService.createPixPlanPayment(user?.sub ?? '', body);
  }

  @Post('pix-plan/:id/link-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar link code para plano PIX de crédito' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async createPixPlanLinkCodeForPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.createPixPlanLinkCodeForPlan(user?.sub ?? '', id, user?.role);
  }

  @Get('pix-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos os planos PIX de crédito do usuário' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  async listPixCreditPlans(
    @CurrentUser() user: JwtPayload | undefined,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('onlyMine') onlyMine?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    const normalizedStatus =
      status === 'ACTIVE' || status === 'INACTIVE' ? status : undefined;

    return this.pixPlanService.listPixCreditPlansPaginated({
      userId: user?.sub ?? '',
      role: user?.role,
      page: pageNumber,
      limit: limitNumber,
      status: normalizedStatus,
      search,
      onlyMine: onlyMine === 'true' || onlyMine === '1',
    });
  }

  @Post('pix-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar plano PIX de crédito (padrão body do /plan)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 401 })
  async createPixCreditPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: CreatePixCreditPlanDto,
  ) {
    return this.pixPlanService.createPixCreditPlanFromPublicDto(user?.sub ?? '', body);
  }

  @Get('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalhe de um plano PIX de crédito' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPixCreditPlanById(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.getPixCreditPlanById(user?.sub ?? '', id, user?.role);
  }

  @Patch('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar plano PIX de crédito' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async updatePixCreditPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() body: UpdatePixCreditPlanDto,
  ) {
    return this.pixPlanService.updatePixCreditPlan(user?.sub ?? '', id, body, user?.role);
  }

  @Delete('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletar plano PIX de crédito' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX a ser deletado' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async deletePixCreditPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.deletePixCreditPlan(user?.sub ?? '', id, user?.role);
  }

  @Post('pix-plan/checkout-by-code')
  @ApiOperation({ summary: 'Criar pagamento PIX-PLAN a partir de um code' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  async createPixPlanPaymentFromCode(
    @Body() body: PixPlanCheckoutByCodeDto,
  ) {
    return this.pixPlanService.createPixPlanPaymentFromCode(body);
  }

  @Get('plan-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consultar acesso do cliente ao plano (crédito de dias)' })
  @ApiQuery({ name: 'document', required: true, type: String })
  @ApiResponse({ status: 200 })
  async getPlanAccess(
    @CurrentUser() user: JwtPayload | undefined,
    @Query('document') document: string,
  ) {
    if (!document) throw new BadRequestException('Documento é obrigatório');
    return this.pixPlanService.getPlanAccess(user?.sub ?? '', document);
  }

  @Get('admin/pix-plan-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos os acessos ativos aos planos PIX (Admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'pixPlanId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @ApiResponse({ status: 200 })
  async listAllPixPlanAccess(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('isActive') isActive?: string,
    @Query('pixPlanId') pixPlanId?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    let isActiveBoolean: boolean | undefined;
    if (isActive !== undefined) isActiveBoolean = isActive === 'true';

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 20;

    return this.pixPlanService.listAllPixPlanAccess({
      page: pageNumber,
      limit: limitNumber,
      userId,
      isActive: isActiveBoolean,
      pixPlanId,
      search: search?.trim() || undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Post('plan-access/decrement-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Decrementar dias de todos os planos ativos (admin)' })
  @ApiResponse({ status: 200 })
  async decrementAllPlanDays() {
    return this.pixPlanService.decrementAllPlanDays();
  }
}

// ── Controller público separado ──────────────────────────────────────────────

@Controller('public')
@ApiTags('Public PIX Plan')
export class PublicPixPlanController {
  constructor(
    private readonly pixPlanService: PixPlanService,
    private readonly pixPlanEvents: PixPlanEventsService,
  ) {}

  @Get('pix-plan-access')
  @ApiOperation({ summary: 'Listar acessos ativos aos planos PIX (Endpoint Público)' })
  @ApiQuery({ name: 'userId', required: true, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  async getPixPlanAccess(
    @Query('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isActive') isActive?: string,
  ) {
    if (!userId) throw new BadRequestException('userId é obrigatório');

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    let isActiveBoolean: boolean | undefined;
    if (isActive !== undefined) isActiveBoolean = isActive === 'true';

    return this.pixPlanService.listAllPixPlanAccess({
      page: pageNumber,
      limit: limitNumber,
      userId,
      isActive: isActiveBoolean,
    });
  }

  @Get('purchase/:transactionId')
  @ApiOperation({ summary: 'Obter detalhes de uma compra (PIX Plan ou Subscription)' })
  @ApiParam({ name: 'transactionId', required: true, type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPurchaseDetails(@Param('transactionId') transactionId: string) {
    if (!transactionId) throw new BadRequestException('transactionId é obrigatório');
    return this.pixPlanService.getPurchaseDetails(transactionId);
  }

  @Sse('pix-plan/status/sse/:transactionId')
  @ApiOperation({ summary: 'SSE: receber confirmação de pagamento PIX-PLAN em tempo real' })
  @ApiParam({ name: 'transactionId', required: true, type: String })
  ssePaymentStatus(
    @Param('transactionId') transactionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Observable<MessageEvent> {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!transactionId) return NEVER;

    const heartbeat$ = timer(0, 20000).pipe(
      map(() => ({ data: { type: 'heartbeat' }, type: 'heartbeat' }) as MessageEvent),
    );
    const payment$ = this.pixPlanEvents.getStream(transactionId).pipe(
      map((event) => ({
        data: event,
        id: event.transactionId,
        type: 'payment-status',
      }) as MessageEvent),
    );
    return merge(heartbeat$, payment$);
  }
}

// ── Controller bot ───────────────────────────────────────────────────────────

@Controller('bot')
@ApiTags('Bot PIX Plan')
export class BotPixPlanController {
  constructor(private readonly pixPlanService: PixPlanService) {}

  @Delete('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletar plano PIX de crédito (Bot)' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX a ser deletado' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async deletePixPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.deletePixCreditPlan(user?.sub ?? '', id, user?.role);
  }

  @Patch('pix-plan/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ativar/Desativar plano PIX (e suspender acessos)' })
  async togglePixPlanStatus(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.togglePixCreditPlanStatus(user?.sub ?? '', id, user?.role);
  }

  /**
   * Endpoint interno: sincroniza o estado do CustomerPlanAccess pelo customerId.
   * Chamado por api-pagatg após pausar/retomar um PixCredit.
   * Protegido por x-pagatg-internal-token.
   */
  @Patch('admin/pix-plan-access/force-state-by-customer')
  @ApiOperation({ summary: '[Interno] Forçar estado do acesso PIX por customerId (api-pagatg → api-machine)' })
  async forceStateByCustomer(
    @Headers('x-pagatg-internal-token') internalToken: string,
    @Body() body: { customerId: string; isActive: boolean; remainingDays: number },
  ) {
    const expected = (getPlatformIntegrationValue('PAGATG', 'INTERNAL_TOKEN') ?? undefined);
    if (expected && internalToken !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
    return this.pixPlanService.forceSetCustomerPlanAccessStatus(
      body.customerId,
      body.isActive,
      body.remainingDays ?? 0,
    );
  }

  @Patch('plan-access/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspender/Reativar acesso ao plano por PIX' })
  async togglePlanAccessStatus(@Param('id') id: string) {
    return this.pixPlanService.toggleCustomerPlanAccessStatus(id);
  }
}
