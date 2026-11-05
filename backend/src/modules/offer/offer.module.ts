import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../../infrastructure/database/repositories/prisma-user.repository';
import { OfferController } from './offer.controller';
import { OfferService } from './offer.service';

@Module({
  controllers: [OfferController],
  providers: [
    OfferService,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
  exports: [OfferService],
})
export class OfferModule {}
