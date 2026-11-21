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
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { AffiliateService } from './affiliate.service';

/** Affiliates of a platform or offer. Session only: integration tokens never configure them. */
@Controller('afiliados')
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
  receipts(@CurrentUser() actor: JwtPayload, @Query('page') page?: string) {
    return this.service.receipts(actor.sub, page);
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
