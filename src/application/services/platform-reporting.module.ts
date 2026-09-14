import { Module } from '@nestjs/common';
import { PlatformReportingService } from './platform-reporting.service';

@Module({
  providers: [PlatformReportingService],
  exports: [PlatformReportingService],
})
export class PlatformReportingModule {}
