import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { SalePushService } from './sale-push.service';
import type { BrowserSubscription } from './sale-push.service';

@Controller('notifications/push')
@UseGuards(JwtAuthGuard)
export class SalePushController {
  constructor(private readonly service: SalePushService) {}
  @Get('public-key') publicKey() { return this.service.publicKey(); }
  @Post('subscriptions') subscribe(@CurrentUser() user: JwtPayload, @Body() body: BrowserSubscription) {
    return this.service.subscribe(user.sub, body);
  }
  @Delete('subscriptions') unsubscribe(@CurrentUser() user: JwtPayload, @Body() body: { endpoint: string }) {
    return this.service.unsubscribe(user.sub, body.endpoint);
  }
}
