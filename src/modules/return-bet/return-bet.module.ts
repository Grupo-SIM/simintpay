import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ReturnBetController } from './return-bet.controller';
import { ReturnBetCommunityStatusService } from './return-bet-community-status.service';
import { ReturnBetWithdrawalService } from './return-bet-withdrawal.service';

@Module({
  controllers: [ReturnBetController],
  providers: [PrismaService, ReturnBetCommunityStatusService, ReturnBetWithdrawalService],
})
export class ReturnBetModule {}
