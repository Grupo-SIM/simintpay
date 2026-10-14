import { Module } from '@nestjs/common';
import { ExternalPlatformDbService } from './external-platform-db.service';

@Module({
  providers: [ExternalPlatformDbService],
  exports: [ExternalPlatformDbService],
})
export class ExternalPlatformDbModule {}
