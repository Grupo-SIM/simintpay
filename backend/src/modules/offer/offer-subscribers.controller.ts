import { Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListOfferSubscribersQueryDto } from './offer-subscribers.dto';
import { OfferSubscribersService } from './offer-subscribers.service';
import type { OfferActor } from './offer.service';

const actorOf = (user: JwtPayload | undefined): OfferActor => ({
  id: user?.sub ?? '',
  role: user?.role ?? 'USER',
});

/** Declarado antes de `OfferController`: `ofertas/assinantes` não pode cair em `ofertas/:id`. */
@Controller('ofertas/assinantes')
@ApiTags('Ofertas')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OfferSubscribersController {
  constructor(private readonly subscribers: OfferSubscribersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar assinantes das ofertas do vendedor' })
  list(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListOfferSubscribersQueryDto,
  ) {
    return this.subscribers.list(actorOf(user), query);
  }

  @Put(':id/pause')
  @ApiOperation({ summary: 'Pausar uma assinatura de oferta' })
  pause(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.subscribers.pause(actorOf(user), id);
  }

  @Put(':id/resume')
  @ApiOperation({
    summary: 'Retomar uma assinatura pausada (recalcula o período)',
  })
  resume(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.subscribers.resume(actorOf(user), id);
  }
}
