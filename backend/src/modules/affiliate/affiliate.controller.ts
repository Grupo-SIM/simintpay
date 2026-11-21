import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CoproductionSessionGuard } from '../coproduction/coproduction-session.guard';
import type { ReceiptFilters } from '../coproduction/coproduction.service';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { AffiliateService } from './affiliate.service';

/**
 * Affiliates of a platform or offer. Session only: integration tokens never configure them.
 *
 * `comissoes` is the canonical prefix: ad blockers (EasyList and similar) block request paths
 * containing "afiliado"/"affiliate" (`net::ERR_BLOCKED_BY_CLIENT`).
 * @deprecated `afiliados` is kept only as an alias (same controller, same guards) so a backend
 * deployed before the frontend keeps serving old clients; remove it once no client uses it.
 */
@Controller(['comissoes', 'afiliados'])
@UseGuards(JwtAuthGuard, CoproductionSessionGuard)
export class AffiliateController {
  constructor(private readonly service: AffiliateService) {}
  @Get('contas')
  @Header('Cache-Control', 'no-store')
  accounts(
    @CurrentUser() actor: JwtPayload,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.service.accounts(actor.sub, search, page);
  }
  @Get('recebimentos')
  @Header('Cache-Control', 'no-store')
  receipts(
    @CurrentUser() actor: JwtPayload,
    @Query() query: ReceiptFilters & { page?: string },
  ) {
    const { page, startDate, endDate, platform, paymentMethod } = query;
    return this.service.receipts(actor.sub, page, {
      startDate,
      endDate,
      platform,
      paymentMethod,
    });
  }
  @Get('plataformas/:platformId')
  @Header('Cache-Control', 'no-store')
  getPlatform(
    @CurrentUser() actor: JwtPayload,
    @Param('platformId') id: string,
  ) {
    return this.service.get(actor.sub, 'plataformas', id);
  }
  @Put('plataformas/:platformId')
  @Header('Cache-Control', 'no-store')
  savePlatform(
    @CurrentUser() actor: JwtPayload,
    @Param('platformId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.save(actor.sub, 'plataformas', id, body);
  }
  @Get('ofertas/:id')
  @Header('Cache-Control', 'no-store')
  getOffer(@CurrentUser() actor: JwtPayload, @Param('id') id: string) {
    return this.service.get(actor.sub, 'ofertas', id);
  }
  @Put('ofertas/:id')
  @Header('Cache-Control', 'no-store')
  saveOffer(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.save(actor.sub, 'ofertas', id, body);
  }
}
