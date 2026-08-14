import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ReturnBetController } from './return-bet.controller';
import { ReturnBetCommunityStatusService } from './return-bet-community-status.service';

@Module({
  controllers: [ReturnBetController],
  providers: [PrismaService, ReturnBetCommunityStatusService],
})
export class ReturnBetModule {}
