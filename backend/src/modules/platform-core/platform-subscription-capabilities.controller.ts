import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  SetMetadata,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import {
  PlatformPlanImportDto,
  PlatformSubscriptionPlanDto,
} from './platform-subscription-capabilities.dto';
import { PlatformSubscriptionCapabilitiesService } from './platform-subscription-capabilities.service';
import { OfferLegacyWriter } from '../offer/offer-legacy-freeze';

@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
export class PlatformSubscriptionCapabilitiesController {
  constructor(
    private readonly capabilities: PlatformSubscriptionCapabilitiesService,
  ) {}

  @OfferLegacyWriter()
  @Post('subscriptions/plans')
  @SetMetadata('platform-operation', 'subscriptions:write')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  create(
    @Req() request: { platformContext: PlatformContext },
    @Body() body: PlatformSubscriptionPlanDto,
  ) {
    return this.capabilities.createPlan(request.platformContext, body);
  }

  @OfferLegacyWriter()
  @Post('subscriptions/plans/import')
  @SetMetadata('platform-operation', 'ledger:write')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  importPlan(
    @Req() request: { platformContext: PlatformContext },
    @Body() body: PlatformPlanImportDto,
  ) {
    return this.capabilities.importPlan(request.platformContext, body);
  }

  @Get('subscriptions/:code/status')
  @SetMetadata('platform-operation', 'subscriptions:read')
  status(
    @Req() request: { platformContext: PlatformContext },
    @Param('code') code: string,
  ) {
    return this.capabilities.paymentStatus(request.platformContext, code);
  }
}
