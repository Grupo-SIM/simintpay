import { Body, Controller, Param, Post, Req, SetMetadata, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { CanonicalCardsService } from './canonical-cards.service';
import { CanonicalCardDto, CanonicalCustomerDto } from './canonical-cards.dto';
@Controller('platforms/:tag/merchants/:externalMerchantId/customers')
@UseGuards(PlatformAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class CanonicalCardsController {
  constructor(private readonly cards: CanonicalCardsService) {}
  @Post() @SetMetadata('platform-operation', 'customers:manage')
  customer(@Req() req: { platformContext: PlatformContext }, @Body() body: CanonicalCustomerDto) { return this.cards.customer(req.platformContext, body); }
  @Post(':customerId/card-tokens') @SetMetadata('platform-operation', 'cards:tokenize')
  tokenize(@Req() req: { platformContext: PlatformContext }, @Param('customerId') id: string, @Body() body: CanonicalCardDto) { return this.cards.tokenize(req.platformContext, id, body); }
}
