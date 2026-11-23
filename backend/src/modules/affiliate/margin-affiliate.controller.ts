import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CoproductionSessionGuard } from '../coproduction/coproduction-session.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { MarginAffiliateService } from './margin-affiliate.service';

/**
 * Affiliates paid from the SimIntPay margin. Session only and admin only (checked by the
 * service). Neutral `comissoes/margem` prefix for the same ad-blocker reason as the regular ones.
 */
@Controller('comissoes/margem')
@UseGuards(JwtAuthGuard, CoproductionSessionGuard)
export class MarginAffiliateController {
  constructor(private readonly service: MarginAffiliateService) {}
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
