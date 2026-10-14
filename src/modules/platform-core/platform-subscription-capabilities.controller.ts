import { Body, Controller, Get, Param, Post, Query, Req, SetMetadata, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformSubscriptionPlanDto } from './platform-subscription-capabilities.dto';
import { PlatformSubscriptionCapabilitiesService } from './platform-subscription-capabilities.service';

@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
export class PlatformSubscriptionCapabilitiesController {
  constructor(private readonly capabilities: PlatformSubscriptionCapabilitiesService) {}

  @Post('subscriptions/plans') @SetMetadata('platform-operation', 'subscriptions:write')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  create(@Req() request: { platformContext: PlatformContext }, @Body() body: PlatformSubscriptionPlanDto) {
    return this.capabilities.createPlan(request.platformContext, body);
  }

  @Get('subscriptions/:code/status') @SetMetadata('platform-operation', 'subscriptions:read')
  status(@Req() request: { platformContext: PlatformContext }, @Param('code') code: string) {
    return this.capabilities.paymentStatus(request.platformContext, code);
  }

  @Get('saas/access') @SetMetadata('platform-operation', 'subscriptions:read')
  access(@Req() request: { platformContext: PlatformContext }, @Query('email') email: string) {
    return this.capabilities.access(request.platformContext, email);
  }
}
