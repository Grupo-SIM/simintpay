import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma/prisma.module';
import { BosqueModule } from '../../modules/bosque/bosque.module';
import { RenovadaModule } from '../../modules/renovada/renovada.module';
import { ModuleRealtimeNotifyService } from './module-realtime-notify.service';

@Module({
  imports: [PrismaModule, BosqueModule, RenovadaModule],
  providers: [ModuleRealtimeNotifyService],
  exports: [ModuleRealtimeNotifyService],
})
export class ModuleRealtimeModule {}
