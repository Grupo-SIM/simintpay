import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { AcquirerFeesService } from './acquirer-fees.service';
import type { FeeInput } from './acquirer-fees';

@ApiTags('Acquirer fees')
@ApiBearerAuth()
@Controller('platforms/acquirers/fees')
@UseGuards(JwtAuthGuard)
export class AcquirerFeesController {
  constructor(private readonly fees: AcquirerFeesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.fees.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { code: string; name: string },
  ) {
    return this.fees.register(user, body);
  }

  @Patch(':code/active')
  active(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() body: { active: boolean },
  ) {
    return this.fees.setActive(user, code, body.active);
  }

  @Get(':code/history')
  history(@CurrentUser() user: JwtPayload, @Param('code') code: string) {
    return this.fees.history(user, code);
  }

  @Post('DOM/sync')
  syncDom(@CurrentUser() user: JwtPayload) {
    return this.fees.syncDom(user);
  }

  @Get('withdrawal')
  listWithdrawal(@CurrentUser() user: JwtPayload) {
    return this.fees.listWithdrawal(user);
  }

  @Post('withdrawal/:code')
  saveWithdrawal(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() body: { feeCents: number },
  ) {
    return this.fees.saveWithdrawal(user, code, body.feeCents);
  }

  @Post(':code')
  save(
    @CurrentUser() user: JwtPayload,
    @Param('code') code: string,
    @Body() body: FeeInput,
  ) {
    return this.fees.save(user, code, body);
  }
}
