import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { Module } from '@nestjs/common';
import { ExternalPlatformDbService } from './external-platform-db.service';

@Module({
  providers: [PrismaService, ExternalPlatformDbService],
  exports: [ExternalPlatformDbService],
})
export class ExternalPlatformDbModule {}
