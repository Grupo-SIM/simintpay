import { PlatformBetaiAdministrationService } from '../../modules/platform-core/platform-betai-administration.service';
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';

/**
 * Espelho no admin-card-machine: o master vê/roda as mensalidades do Betai.
 * O estado mora no Betai; aqui só fazemos proxy para os endpoints internos dele
 * (via BETAI_URL + token interno).
 */
@Controller('admin/betai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
@ApiTags('Betai (admin)')
export class BetaiAdminController {
  constructor(private readonly administration: PlatformBetaiAdministrationService) {}

  @Get('mensalidades')
  @ApiOperation({ summary: 'Lista as mensalidades do Betai (proxy)' })
  async mensalidades() { return this.administration.legacy('invoices'); }

  @Post('mensalidades/run')
  @ApiOperation({ summary: 'Roda geração/reconciliação das mensalidades do Betai (proxy)' })
  async run() { return this.administration.legacy('run'); }

  @Get('cobranca')
  @ApiOperation({ summary: 'Config de cobrança da mensalidade (padrão global + exceções) (proxy)' })
  async cobranca() { return this.administration.legacy('configuration'); }

  @Put('cobranca')
  @ApiOperation({ summary: 'Salva config de cobrança da mensalidade (proxy)' })
  async saveCobranca(@Body() body: unknown) { return this.administration.legacy('saveConfiguration', { body }); }

  @Get('investors')
  @ApiOperation({ summary: 'Busca investidores do Betai por nome/e-mail/telefone/CPF (proxy)' })
  async investors(@Query('q') q: string) { return this.administration.legacy('investors', { query: q }); }

  @Post('cobrar')
  @ApiOperation({ summary: 'Cobra a mensalidade do mês atual (todos/selecionados) (proxy)' })
  async cobrar(@Body() body: unknown) { return this.administration.legacy('charge', { body }); }

  @Patch('mensalidades/:id')
  @ApiOperation({ summary: 'Edita uma mensalidade (valor/vencimento/status) (proxy)' })
  async editMensalidade(@Param('id') id: string, @Body() body: unknown) { return this.administration.legacy('editInvoice', { id, body }); }

  @Delete('mensalidades/:id')
  @ApiOperation({ summary: 'Remove uma mensalidade (proxy)' })
  async deleteMensalidade(@Param('id') id: string) { return this.administration.legacy('deleteInvoice', { id }); }
}
