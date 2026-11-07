import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreatePaymentLinkDto } from '../../application/dtos/payment-link/create-payment-link.dto';
import { ListPaymentLinksQueryDto } from '../../application/dtos/payment-link/list-payment-links.query.dto';
import { UpdatePaymentLinkDto } from '../../application/dtos/payment-link/update-payment-link.dto';
import { CreateSubscriptionLinkDto } from '../../application/dtos/subscription-link/create-subscription-link.dto';
import { UpdateSubscriptionLinkDto } from '../../application/dtos/subscription-link/update-subscription-link.dto';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { LegacyLinksCompatService } from './legacy-links.compat.service';
import type { OfferActor } from './offer.service';

const actorOf = (user: JwtPayload | undefined): OfferActor => ({
  id: user?.sub ?? '',
  role: user?.role ?? 'USER',
});

/**
 * `/links-pagamento` adapter backed by `Offer`. Mounted instead of `PaymentLinkController` when
 * `OFFER_LEGACY_LINKS_COMPAT=1` (see `legacy-links.compat.ts`). Charge, PIX, file and funnel
 * routes are not ported: the new checkout uses `/ofertas`.
 */
@Controller('links-pagamento')
@ApiTags('Links de Pagamento (compat Ofertas)')
export class PaymentLinksCompatController {
  constructor(private readonly links: LegacyLinksCompatService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar links de pagamento' })
  list(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListPaymentLinksQueryDto,
  ) {
    return this.links.listPaymentLinks(actorOf(user), query);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar link de pagamento' })
  create(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.links.createPaymentLink(actorOf(user), dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buscar link de pagamento por id' })
  get(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.links.getPaymentLink(actorOf(user), id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar link de pagamento' })
  update(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkDto,
  ) {
    return this.links.updatePaymentLink(actorOf(user), id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover (desativar) link de pagamento' })
  remove(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.links.deletePaymentLink(actorOf(user), id);
  }
}

/** `/links-assinatura` adapter backed by `Offer`; see `PaymentLinksCompatController`. */
@Controller('links-assinatura')
@ApiTags('Links de Assinatura (compat Ofertas)')
export class SubscriptionLinksCompatController {
  constructor(private readonly links: LegacyLinksCompatService) {}

  @Get('public/:code')
  @ApiOperation({ summary: 'Detalhes públicos do link de assinatura' })
  getPublic(@Param('code') code: string) {
    return this.links.getPublicSubscriptionLink(code);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar links de assinatura' })
  list(
    @CurrentUser() user: JwtPayload | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('onlyMine') onlyMine?: string,
  ) {
    return this.links.listSubscriptionLinks(actorOf(user), {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      onlyMine: onlyMine === 'true' || onlyMine === '1',
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar link de assinatura' })
  create(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreateSubscriptionLinkDto,
  ) {
    return this.links.createSubscriptionLink(actorOf(user), dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buscar link de assinatura por id' })
  get(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.links.getSubscriptionLink(actorOf(user), id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar link de assinatura' })
  update(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionLinkDto,
  ) {
    return this.links.updateSubscriptionLink(actorOf(user), id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover (desativar) link de assinatura' })
  remove(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.links.deleteSubscriptionLink(actorOf(user), id);
  }
}
