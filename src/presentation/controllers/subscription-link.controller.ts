import {
  Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { CreateSubscriptionLinkDto } from '../../application/dtos/subscription-link/create-subscription-link.dto';
import { UpdateSubscriptionLinkDto } from '../../application/dtos/subscription-link/update-subscription-link.dto';
import {
  CheckoutSubscriptionLinkCardDto,
  CheckoutSubscriptionLinkPixDto,
} from '../../application/dtos/subscription-link/checkout-subscription-link.dto';
import { CreateSubscriptionLinkUseCase } from '../../application/use-cases/subscription-link/create-subscription-link.use-case';
import { ListSubscriptionLinksUseCase } from '../../application/use-cases/subscription-link/list-subscription-links.use-case';
import { GetPublicSubscriptionLinkUseCase } from '../../application/use-cases/subscription-link/get-public-subscription-link.use-case';
import { UpdateSubscriptionLinkUseCase } from '../../application/use-cases/subscription-link/update-subscription-link.use-case';
import { DeleteSubscriptionLinkUseCase } from '../../application/use-cases/subscription-link/delete-subscription-link.use-case';
import { CheckoutSubscriptionLinkCardUseCase } from '../../application/use-cases/subscription-link/checkout-subscription-link-card.use-case';
import { CheckoutSubscriptionLinkPixUseCase } from '../../application/use-cases/subscription-link/checkout-subscription-link-pix.use-case';
import { ListSubscriptionLinkOrdersUseCase } from '../../application/use-cases/subscription-link/list-subscription-link-orders.use-case';

@Controller('links-assinatura')
@ApiTags('Links de Assinatura')
export class SubscriptionLinkController {
  constructor(
    private readonly createUC: CreateSubscriptionLinkUseCase,
    private readonly listUC: ListSubscriptionLinksUseCase,
    private readonly getPublicUC: GetPublicSubscriptionLinkUseCase,
    private readonly updateUC: UpdateSubscriptionLinkUseCase,
    private readonly deleteUC: DeleteSubscriptionLinkUseCase,
    private readonly checkoutCardUC: CheckoutSubscriptionLinkCardUseCase,
    private readonly checkoutPixUC: CheckoutSubscriptionLinkPixUseCase,
    private readonly listOrdersUC: ListSubscriptionLinkOrdersUseCase,
  ) {}

  // ── Rotas públicas ──────────────────────────────────────────────────────────

  @Get('public/:code')
  @ApiOperation({ summary: 'Detalhes públicos do link de assinatura (checkout)' })
  async getPublic(@Param('code') code: string) {
    return this.getPublicUC.execute(code);
  }

  @Post('public/:code/assinar')
  @ApiOperation({ summary: 'Checkout por cartão de crédito' })
  async checkoutCard(
    @Param('code') code: string,
    @Body() dto: CheckoutSubscriptionLinkCardDto,
  ) {
    return this.checkoutCardUC.execute({ code, dto });
  }

  @Post('public/:code/pix')
  @ApiOperation({ summary: 'Checkout por PIX' })
  async checkoutPix(
    @Param('code') code: string,
    @Body() dto: CheckoutSubscriptionLinkPixDto,
  ) {
    return this.checkoutPixUC.execute({ code, dto });
  }

  // ── Rotas autenticadas ──────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar links de assinatura' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.listUC.execute({
      userId: user.sub,
      role: user.role,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar link de assinatura' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSubscriptionLinkDto,
  ) {
    return this.createUC.execute({ userId: user.sub, role: user.role, dto });
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar link de assinatura' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionLinkDto,
  ) {
    return this.updateUC.execute({ userId: user.sub, role: user.role, id, dto });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover link de assinatura' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.deleteUC.execute({ userId: user.sub, role: user.role, id });
  }

  @Get(':id/assinantes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar assinantes do link' })
  async listOrders(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.listOrdersUC.execute({
      userId: user.sub,
      role: user.role,
      linkId: id,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }
}
