import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CoproductionController } from './coproduction.controller';
import { CoproductionService } from './coproduction.service';

@Module({ controllers: [CoproductionController], providers: [CoproductionService, JwtAuthGuard] })
export class CoproductionModule {}
