import {
  Body,
  Controller,
  Delete,
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
import { AcquirerWithdrawalsService } from './acquirer-withdrawals.service';

@ApiTags('Acquirer withdrawals')
@ApiBearerAuth()
@Controller('admin/acquirer-withdrawals')
@UseGuards(JwtAuthGuard)
export class AcquirerWithdrawalsController {
  constructor(private readonly withdrawals: AcquirerWithdrawalsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.withdrawals.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { acquirerCode?: string; date?: string },
  ) {
    return this.withdrawals.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { date?: string },
  ) {
    return this.withdrawals.updateDate(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.withdrawals.remove(user, id);
  }
}
