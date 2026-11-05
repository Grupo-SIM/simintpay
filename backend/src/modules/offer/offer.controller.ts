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
