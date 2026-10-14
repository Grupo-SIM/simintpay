import { Body, Controller, Delete, Get, Param, Post, Req, SetMetadata, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformVoucherDto, PlatformVoucherValidationDto } from './platform-voucher.dto';
import { PlatformVoucherCapabilitiesService } from './platform-voucher-capabilities.service';

@Controller('platforms/:tag/vouchers')
@UseGuards(PlatformAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class PlatformVoucherCapabilitiesController {
  constructor(private readonly vouchers: PlatformVoucherCapabilitiesService) {}
  @Get() @SetMetadata('platform-operation', 'vouchers:read')
  list(@Req() request: { platformContext: PlatformContext }) { return this.vouchers.list(request.platformContext); }
  @Post() @SetMetadata('platform-operation', 'vouchers:write')
  create(@Req() request: { platformContext: PlatformContext }, @Body() body: PlatformVoucherDto) { return this.vouchers.create(request.platformContext, body); }
  @Post('validate') @SetMetadata('platform-operation', 'vouchers:read')
  validate(@Req() request: { platformContext: PlatformContext }, @Body() body: PlatformVoucherValidationDto) { return this.vouchers.validate(request.platformContext, body); }
  @Delete(':id') @SetMetadata('platform-operation', 'vouchers:write')
  delete(@Req() request: { platformContext: PlatformContext }, @Param('id') id: string) { return this.vouchers.delete(request.platformContext, id); }
}
