import { Module } from '@nestjs/common';
import { CoproductionSessionGuard } from '../coproduction/coproduction-session.guard';
import { CoproductionService } from '../coproduction/coproduction.service';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { AffiliateController } from './affiliate.controller';
import { AffiliateService } from './affiliate.service';
import { MarginAffiliateController } from './margin-affiliate.controller';
import { MarginAffiliateService } from './margin-affiliate.service';

@Module({
  controllers: [AffiliateController, MarginAffiliateController],
  providers: [
    AffiliateService,
    MarginAffiliateService,
    CoproductionService,
    JwtAuthGuard,
    CoproductionSessionGuard,
  ],
})
export class AffiliateModule {}
