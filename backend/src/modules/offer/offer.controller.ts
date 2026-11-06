import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import {
  CreateOfferDto,
  ListOffersQueryDto,
  OfferChargeDto,
  UpdateOfferDto,
} from './offer.dto';
import { OfferCheckoutService } from './offer-checkout.service';
import { OfferRenewDto } from './offer-renewal.dto';
import { OfferRenewalService } from './offer-renewal.service';
import { OfferCardCustomerDto, OfferSubscribeDto } from './offer-subscribe.dto';
import { OfferSubscribeService } from './offer-subscribe.service';
import { OfferService, type OfferActor } from './offer.service';

const actorOf = (user: JwtPayload | undefined): OfferActor => ({
  id: user?.sub ?? '',
  role: user?.role ?? 'USER',
});

@Controller('ofertas')
@ApiTags('Ofertas')
export class OfferController {
  constructor(
    private readonly offers: OfferService,
    private readonly checkout: OfferCheckoutService,
    private readonly subscriptions: OfferSubscribeService,
    private readonly renewals: OfferRenewalService,
  ) {}

  // ── Rota pública (sem autenticação): somente campos seguros ───────────────

  @Get('public/:code')
  @ApiOperation({ summary: 'Detalhes públicos de uma oferta (checkout)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  getPublic(@Param('code') code: string) {
    return this.offers.getPublicByCode(code);
  }

  @Post('public/:code/charge')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Cobrar uma oferta avulsa (checkout público: PIX ou cartão)',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  charge(
    @Param('code') code: string,
    @Body() body: OfferChargeDto,
    @Query() query: Record<string, string>,
  ) {
    return this.checkout.charge(code, {
      ...body,
      tracking: { ...query, ...body.tracking },
    });
  }

  @Post('public/:code/card-customer')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Cria/recupera o cliente no adquirente e devolve customerId + publicKey para tokenizar o cartão no navegador',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  cardCustomer(
    @Param('code') code: string,
    @Body() body: OfferCardCustomerDto,
  ) {
    return this.subscriptions.cardCustomer(code, body);
  }

  @Post('public/:code/subscribe')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Contratar uma oferta recorrente (checkout público: cartão para AUTO_CHARGE, PIX para MANUAL_PAY)',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  subscribe(
    @Param('code') code: string,
    @Body() body: OfferSubscribeDto,
    @Query() query: Record<string, string>,
  ) {
    return this.subscriptions.subscribe(code, {
      ...body,
      tracking: { ...query, ...body.tracking },
    });
  }

  @Post('public/:code/renew')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Renovar ou reativar uma assinatura por PIX (link assinado, sem login)',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  renew(@Param('code') code: string, @Body() body: OfferRenewDto) {
    return this.renewals.renew(code, body);
  }

  // ── Rotas autenticadas ────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar ofertas' })
  list(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListOffersQueryDto,
  ) {
    return this.offers.list(actorOf(user), query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Detalhar oferta (somente do titular; admin vê todas)',
  })
  @ApiResponse({ status: 404 })
  get(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.offers.get(actorOf(user), id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar oferta' })
  create(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreateOfferDto,
  ) {
    return this.offers.create(actorOf(user), dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar oferta' })
  update(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.update(actorOf(user), id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desativar oferta' })
  deactivate(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.offers.deactivate(actorOf(user), id);
  }
}
