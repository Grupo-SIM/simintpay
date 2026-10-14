import { LegacyInternalAuthGuard } from '../../modules/platform-core/legacy-internal-auth.guard';
import { SetMetadata, UseGuards } from '@nestjs/common';
import { InternalAtlasFinanceService } from '../../modules/unified-platform/finance/legacy-atlas-finance.service';
import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';

@Controller('internal/atlas/finance')
@SetMetadata('legacy-platform-tag', 'ATLAS')
@UseGuards(LegacyInternalAuthGuard)
export class InternalAtlasFinanceController {
  constructor(private readonly finance: InternalAtlasFinanceService) {}

  @Get('health')
  @SetMetadata('legacy-public', true)
  async health() { return this.finance.health(); }

  @Get('summary')
  async summary(
    @Query('cpf') cpf: string,
    @Query('email') email?: string,
    @Query('userId') userId?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.summary(cpf, email, userId, internalToken); }

  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { cpf?: string; email?: string; userId?: string; amount: number; pixKey: string },
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.requestWithdraw(body, internalToken); }

  @Get('withdraw/:id')
  async getWithdrawStatus(
    @Param('id') id: string,
    @Headers('x-internal-token') internalToken?: string,
  ) { return this.finance.getWithdrawStatus(id, internalToken); }
}
