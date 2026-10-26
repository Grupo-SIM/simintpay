import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { HttpModule } from '@nestjs/axios';
import { PlatformSyncPersistenceService } from './platform-sync-persistence.service';
import { Global, Module } from '@nestjs/common';
import { PlatformEventsService } from './platform-events.service';

@Global()
@Module({ imports: [PrismaModule, ApiDomModule, HttpModule], providers: [PlatformEventsService, PlatformSyncPersistenceService], exports: [PlatformEventsService, PlatformSyncPersistenceService] })
export class PlatformEventsModule {}
