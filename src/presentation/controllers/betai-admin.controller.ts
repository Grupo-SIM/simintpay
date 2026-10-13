import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
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
  InternalServerErrorException,
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
  private betaiUrl(): string {
    return String((getPlatformIntegrationValue('BETAI', 'BACKEND_URL') ?? undefined) ?? '').replace(/\/+$/, '');
  }
  private token(): string {
    return process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
  }

  @Get('mensalidades')
  @ApiOperation({ summary: 'Lista as mensalidades do Betai (proxy)' })
  async mensalidades() {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/invoices`, {
      headers: { 'x-internal-token': this.token() },
    });
    if (!resp.ok) {
      throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    }
    return resp.json();
  }

  @Post('mensalidades/run')
  @ApiOperation({ summary: 'Roda geração/reconciliação das mensalidades do Betai (proxy)' })
  async run() {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/run`, {
      method: 'POST',
      headers: { 'x-internal-token': this.token() },
    });
    if (!resp.ok) {
      throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    }
    return resp.json();
  }

  @Get('cobranca')
  @ApiOperation({ summary: 'Config de cobrança da mensalidade (padrão global + exceções) (proxy)' })
  async cobranca() {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/cobranca`, {
      headers: { 'x-internal-token': this.token() },
    });
    if (!resp.ok) throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    return resp.json();
  }

  @Put('cobranca')
  @ApiOperation({ summary: 'Salva config de cobrança da mensalidade (proxy)' })
  async saveCobranca(@Body() body: unknown) {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/cobranca`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': this.token() },
      body: JSON.stringify(body ?? {}),
    });
    if (!resp.ok) throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    return resp.json();
  }

  @Get('investors')
  @ApiOperation({ summary: 'Busca investidores do Betai por nome/e-mail/telefone/CPF (proxy)' })
  async investors(@Query('q') q: string) {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/investors?q=${encodeURIComponent(q ?? '')}`, {
      headers: { 'x-internal-token': this.token() },
    });
    if (!resp.ok) throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    return resp.json();
  }

  @Post('cobrar')
  @ApiOperation({ summary: 'Cobra a mensalidade do mês atual (todos/selecionados) (proxy)' })
  async cobrar(@Body() body: unknown) {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/cobrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': this.token() },
      body: JSON.stringify(body ?? {}),
    });
    if (!resp.ok) throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    return resp.json();
  }

  @Patch('mensalidades/:id')
  @ApiOperation({ summary: 'Edita uma mensalidade (valor/vencimento/status) (proxy)' })
  async editMensalidade(@Param('id') id: string, @Body() body: unknown) {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/invoices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': this.token() },
      body: JSON.stringify(body ?? {}),
    });
    if (!resp.ok) throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    return resp.json();
  }

  @Delete('mensalidades/:id')
  @ApiOperation({ summary: 'Remove uma mensalidade (proxy)' })
  async deleteMensalidade(@Param('id') id: string) {
    const url = this.betaiUrl();
    if (!url) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const resp = await fetch(`${url}/internal/mensalidade/invoices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-internal-token': this.token() },
    });
    if (!resp.ok) throw new InternalServerErrorException(`Betai respondeu ${resp.status}`);
    return resp.json();
  }
}
