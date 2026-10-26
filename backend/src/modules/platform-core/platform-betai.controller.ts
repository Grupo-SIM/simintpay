import { Body, Controller, Get, Param, Post, Req, SetMetadata, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformBetaiService } from './platform-betai.service';

export class PlatformBetaiBillDto {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amountCents!: number;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() email?: string;
}
export class PlatformBetaiCancelDto {
  @IsString() @IsNotEmpty() code!: string;
}

@Controller('platforms/:tag/billing')
@UseGuards(PlatformAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class PlatformBetaiController {
  constructor(private readonly betai: PlatformBetaiService) {}
  @Post() @SetMetadata('platform-operation', 'billing:write')
  create(@Req() request: { platformContext: PlatformContext }, @Body() body: PlatformBetaiBillDto) {
    return this.betai.createBill(request.platformContext, body);
  }
  @Get(':code/status') @SetMetadata('platform-operation', 'billing:read')
  async status(@Req() request: { platformContext: PlatformContext }, @Param('code') code: string) {
    const result = await this.betai.status(request.platformContext, code);
    return { paid: result.pago, paidAt: result.pagoEm };
  }
  @Post('subscriptions/cancel') @SetMetadata('platform-operation', 'subscriptions:write')
  async cancel(@Req() request: { platformContext: PlatformContext }, @Body() body: PlatformBetaiCancelDto) {
    const result = await this.betai.cancelPlan(request.platformContext, body.code);
    return { found: result.encontrada, cancelled: result.canceladas };
  }
}
