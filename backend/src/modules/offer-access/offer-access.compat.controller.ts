import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { NEVER, Observable, merge, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { CreatePixCreditPlanDto } from '../../application/dtos/pix-plan/create-pix-credit-plan.dto';
import { PixPlanCheckoutByCodeDto } from '../../application/dtos/pix-plan/pix-plan-checkout-by-code.dto';
import { PixPlanCheckoutDto } from '../../application/dtos/pix-plan/pix-plan-checkout.dto';
import { UpdatePixCreditPlanDto } from '../../application/dtos/pix-plan/update-pix-credit-plan.dto';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';
import { OfferAccessEventsService } from './offer-access-events.service';
import { OfferAccessCompatService } from './offer-access.compat.service';
import { OfferAccessService } from './offer-access.service';

/**
 * Rotas de compatibilidade para o api-pagatg: mesmos caminhos, autenticação e JSON do
 * `PixPlanController` legado, apoiadas em Offer/OfferAccess/OfferCodeAlias. Só são montadas
 * com `OFFER_PIXPLAN_COMPAT=1` (veja `offer-access.module.ts`); sem a flag o legado responde.
 */
@Controller('payments')
@ApiTags('PIX Plan (ofertas)')
export class PixPlanCompatController {
  constructor(
    private readonly compat: OfferAccessCompatService,
    private readonly access: OfferAccessService,
  ) {}

  // ── Públicas ──
  @Get('pix-plan/link-code/:code')
  getLinkCode(@Param('code') code: string) {
    return this.compat.getLinkCode(code);
  }

  @Get('pix-plan/link-code-details/:code/checkout')
  getLinkCodeDetails(@Param('code') code: string) {
    return this.compat.getLinkCodeDetails(code);
  }

  // ── Autenticadas ──
  @Post('pix-plan/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  checkout(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: PixPlanCheckoutDto,
  ) {
    return this.compat.checkout(user?.sub ?? '', body);
  }

  @Post('pix-plan/:id/link-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createLinkCode(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.compat.createLinkCode(user?.sub ?? '', id, user?.role);
  }

  @Get('pix-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listPlans(
    @CurrentUser() user: JwtPayload | undefined,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('onlyMine') onlyMine?: string,
  ) {
    return this.compat.listPlans({
      userId: user?.sub ?? '',
      role: user?.role,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
      status: status === 'ACTIVE' || status === 'INACTIVE' ? status : undefined,
      search,
      onlyMine: onlyMine === 'true' || onlyMine === '1',
    });
  }

  @Post('pix-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: CreatePixCreditPlanDto,
  ) {
    return this.compat.createPlan(user?.sub ?? '', user?.role, body);
  }

  @Get('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.compat.getPlan(user?.sub ?? '', id, user?.role);
  }

  @Patch('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  updatePlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() body: UpdatePixCreditPlanDto,
  ) {
    return this.compat.updatePlan(user?.sub ?? '', id, body, user?.role);
  }

  @Delete('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  deletePlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.compat.deletePlan(user?.sub ?? '', id, user?.role);
  }

  @Post('pix-plan/checkout-by-code')
  checkoutByCode(@Body() body: PixPlanCheckoutByCodeDto) {
    return this.compat.checkoutByCode(body);
  }

  @Get('plan-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getPlanAccess(
    @CurrentUser() user: JwtPayload | undefined,
    @Query('document') document: string,
  ) {
    if (!document) throw new BadRequestException('Documento é obrigatório');
    return this.access.getPlanAccess(user?.sub ?? '', document);
  }

  // Mesma autenticação do legado: qualquer usuário autenticado (sem checagem de papel).
  @Get('admin/pix-plan-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listAccess(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('isActive') isActive?: string,
    @Query('pixPlanId') pixPlanId?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.compat.listAccess({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      userId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      pixPlanId,
      search: search?.trim() || undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Post('plan-access/decrement-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Expira créditos vencidos (também roda no cron horário)',
  })
  decrementAll() {
    return this.access.decrementAll();
  }
}

@Controller('public')
@ApiTags('Public PIX Plan (ofertas)')
export class PublicPixPlanCompatController {
  constructor(
    private readonly compat: OfferAccessCompatService,
    private readonly events: OfferAccessEventsService,
  ) {}

  @Get('pix-plan-access')
  listAccess(
    @Query('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isActive') isActive?: string,
  ) {
    if (!userId) throw new BadRequestException('userId é obrigatório');
    return this.compat.listAccess({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 100) : 20,
      userId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('purchase/:transactionId')
  purchase(@Param('transactionId') transactionId: string) {
    if (!transactionId)
      throw new BadRequestException('transactionId é obrigatório');
    return this.compat.purchaseDetails(transactionId);
  }

  @Sse('pix-plan/status/sse/:transactionId')
  sse(
    @Param('transactionId') transactionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Observable<MessageEvent> {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!transactionId) return NEVER;
    const heartbeat$ = timer(0, 20000).pipe(
      map(
        () =>
          ({ data: { type: 'heartbeat' }, type: 'heartbeat' }) as MessageEvent,
      ),
    );
    const payment$ = this.events.getStream(transactionId).pipe(
      map(
        (event) =>
          ({
            data: event,
            id: event.transactionId,
            type: 'payment-status',
          }) as MessageEvent,
      ),
    );
    return merge(heartbeat$, payment$);
  }
}

@Controller('bot')
@ApiTags('Bot PIX Plan (ofertas)')
export class BotPixPlanCompatController {
  constructor(
    private readonly compat: OfferAccessCompatService,
    private readonly access: OfferAccessService,
  ) {}

  @Delete('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  deletePlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.compat.deletePlan(user?.sub ?? '', id, user?.role);
  }

  @Patch('pix-plan/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  togglePlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.compat.togglePlanStatus(user?.sub ?? '', id, user?.role);
  }

  /** Interno: o api-pagatg sincroniza o estado após pausar/retomar um PixCredit. */
  @Patch('admin/pix-plan-access/force-state-by-customer')
  forceStateByCustomer(
    @Headers('x-pagatg-internal-token') internalToken: string,
    @Body()
    body: { customerId: string; isActive: boolean; remainingDays: number },
  ) {
    const expected =
      getPlatformIntegrationValue('PAGATG', 'INTERNAL_TOKEN') ?? undefined;
    if (expected && internalToken !== expected)
      throw new UnauthorizedException('Token interno inválido');
    return this.access.forceStateByCustomer(
      body.customerId,
      body.isActive,
      body.remainingDays ?? 0,
    );
  }

  @Patch('plan-access/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  toggleAccess(@Param('id') id: string) {
    return this.access.toggleStatus(id);
  }
}
