import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ReturnBetCommunityStatusService,
  CommunityStatusResult,
} from './return-bet-community-status.service';
import {
  ReturnBetWithdrawalService,
  type ReturnBetWithdrawalInput,
} from './return-bet-withdrawal.service';

interface BatchCheckItem {
  id: string;
  cpf?: string;
  email?: string;
}

@Controller('internal/return-bet')
export class ReturnBetController {
  constructor(
    private readonly communityStatus: ReturnBetCommunityStatusService,
    private readonly withdrawals: ReturnBetWithdrawalService,
  ) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.RETURN_BET_INTERNAL_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  @Get('community-status')
  async communityStatus_(
    @Query('cpf') cpf: string | undefined,
    @Query('email') email: string | undefined,
    @Headers('x-internal-token') internalToken?: string,
  ): Promise<CommunityStatusResult> {
    this.ensureInternalToken(internalToken);
    return this.communityStatus.checkOne({ cpf, email });
  }

  @Post('community-status/batch')
  async communityStatusBatch(
    @Body() body: { users: BatchCheckItem[] },
    @Headers('x-internal-token') internalToken?: string,
  ): Promise<{ results: Array<{ id: string } & CommunityStatusResult> }> {
    this.ensureInternalToken(internalToken);
    const users = Array.isArray(body?.users) ? body.users : [];
    const results = await Promise.all(
      users.map(async (u) => ({
        id: u.id,
        ...(await this.communityStatus.checkOne({ cpf: u.cpf, email: u.email })),
      })),
    );
    return { results };
  }

  @Post('withdrawals')
  requestWithdrawal(
    @Body() body: ReturnBetWithdrawalInput,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    return this.withdrawals.request(body);
  }

  @Post('withdrawals/status/batch')
  async withdrawalStatusBatch(
    @Body() body: { requestIds?: string[] },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    return {
      results: await this.withdrawals.listStatus(
        Array.isArray(body?.requestIds) ? body.requestIds : [],
      ),
    };
  }

  @Post('withdrawals/:requestId/approve')
  approveWithdrawal(
    @Param('requestId') requestId: string,
    @Body() body: { receiptImage: string; actorReference?: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    return this.withdrawals.approve(requestId, body.receiptImage, {
      actorReference: body.actorReference,
    });
  }

  @Post('withdrawals/:requestId/reject')
  rejectWithdrawal(
    @Param('requestId') requestId: string,
    @Body() body: { reason: string; actorReference?: string },
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    return this.withdrawals.reject(requestId, body.reason, {
      actorReference: body.actorReference,
    });
  }
}
