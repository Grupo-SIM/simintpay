import { Module } from '@nestjs/common';
import { CoproductionSessionGuard } from '../coproduction/coproduction-session.guard';
import { CoproductionService } from '../coproduction/coproduction.service';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { AffiliateController } from './affiliate.controller';
import { AffiliateService } from './affiliate.service';

@Module({
  controllers: [AffiliateController],
  providers: [
    AffiliateService,
    CoproductionService,
    JwtAuthGuard,
    CoproductionSessionGuard,
  ],
})
export class AffiliateModule {}
