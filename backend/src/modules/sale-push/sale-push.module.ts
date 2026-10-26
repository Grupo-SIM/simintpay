import { Module } from '@nestjs/common';
import { SalePushController } from './sale-push.controller';
import { SalePushService } from './sale-push.service';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
@Module({ controllers: [SalePushController], providers: [SalePushService, JwtAuthGuard] })
export class SalePushModule {}
