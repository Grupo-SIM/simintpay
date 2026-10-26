import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { VoucherService } from '../../application/use-cases/voucher/voucher.service';
import {
  CreateVoucherDto,
  UpdateVoucherDto,
  ValidateVoucherDto,
  RecordVoucherUsageDto,
} from '../../application/dtos/voucher/voucher.dto';

@Controller('vouchers')
@ApiTags('Vouchers')
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar vouchers do usuário' })
  @ApiResponse({ status: 200 })
  async list(@CurrentUser() user: JwtPayload) {
    return this.voucherService.listVouchers(user.sub, user.role ?? 'USER');
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar voucher' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVoucherDto,
  ) {
    return this.voucherService.createVoucher(user.sub, dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar voucher' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVoucherDto,
  ) {
    return this.voucherService.updateVoucher(user.sub, user.role ?? 'USER', id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletar voucher' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.voucherService.deleteVoucher(user.sub, user.role ?? 'USER', id);
  }

  /**
   * Validação de voucher para checkout.
   * Busca por code globalmente (sem filtro de userId) para suportar flows onde
   * o token autenticado pertence a um usuário diferente do dono do voucher
   * (ex: api-pagatg chamando com token do vendedor, mas voucher criado via outra conta).
   */
  @Post('validate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validar voucher para checkout' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  async validate(
    @Body() dto: ValidateVoucherDto,
  ) {
    return this.voucherService.validateVoucherPublic({
      code: dto.code ?? dto.voucherCode ?? '',
      amount: dto.amount,
      channel: dto.channel,
      planId: dto.planId,
      linkCode: dto.linkCode,
      targetOwnerId: dto.targetOwnerId,
    });
  }

  @Post('usage/record')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar uso de voucher' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async recordUsage(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordVoucherUsageDto,
  ) {
    return this.voucherService.recordUsage(dto);
  }
}
