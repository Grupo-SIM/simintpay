import { CoproductionSessionGuard } from './coproduction-session.guard';
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
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import type { ReceiptFilters } from './coproduction.service';
import { CoproductionService } from './coproduction.service';

@Controller('coproducao')
@UseGuards(JwtAuthGuard, CoproductionSessionGuard)
export class CoproductionController {
  constructor(private readonly service: CoproductionService) {}
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
  @Get(':product/:id')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentUser() actor: JwtPayload,
    @Param('product') product: string,
    @Param('id') id: string,
  ) {
    return this.service.get(actor.sub, product, id);
  }
  @Put(':product/:id')
  @Header('Cache-Control', 'no-store')
  save(
    @CurrentUser() actor: JwtPayload,
    @Param('product') product: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.save(actor.sub, product, id, body);
  }
}
