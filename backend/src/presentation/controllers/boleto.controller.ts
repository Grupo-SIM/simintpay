import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { CreateBoletoDto } from '../../application/dtos/boleto/create-boleto.dto';
import { UpdateBoletoDto } from '../../application/dtos/boleto/update-boleto.dto';
import { ListBoletosQueryDto } from '../../application/dtos/boleto/list-boletos.query.dto';
import { CreateBoletoUseCase } from '../../application/use-cases/boleto/create-boleto.use-case';
import { ListBoletosUseCase } from '../../application/use-cases/boleto/list-boletos.use-case';
import { GetBoletoUseCase } from '../../application/use-cases/boleto/get-boleto.use-case';
import { UpdateBoletoUseCase } from '../../application/use-cases/boleto/update-boleto.use-case';
import { DeleteBoletoUseCase } from '../../application/use-cases/boleto/delete-boleto.use-case';
import { GetPublicBoletoUseCase } from '../../application/use-cases/boleto/get-public-boleto.use-case';
import { ChargeBoletoUseCase } from '../../application/use-cases/boleto/charge-boleto.use-case';
import { ChargeBoletoPixUseCase } from '../../application/use-cases/boleto/charge-boleto-pix.use-case';
import { PublicChargeBoletoDto } from '../../application/dtos/boleto/public-charge-boleto.dto';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('boletos')
@ApiTags('Boletos')
export class BoletoController {
  constructor(
    private readonly create: CreateBoletoUseCase,
    private readonly list: ListBoletosUseCase,
    private readonly getOne: GetBoletoUseCase,
    private readonly update: UpdateBoletoUseCase,
    private readonly del: DeleteBoletoUseCase,
    private readonly getPublic: GetPublicBoletoUseCase,
    private readonly charge: ChargeBoletoUseCase,
    private readonly chargePix: ChargeBoletoPixUseCase,
  ) {}

  // ── Rotas públicas (sem autenticação) ──────────────────────────────────────

  @Get('public/:id')
  @ApiOperation({ summary: 'Detalhes públicos de um boleto (checkout)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPublicRoute(@Param('id') id: string) {
    return this.getPublic.execute(id);
  }

  @Post('public/:id/boleto')
  @ApiOperation({ summary: 'Gerar boleto (checkout público)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async chargeBoletoRoute(
    @Param('id') id: string,
    @Body() body: PublicChargeBoletoDto,
  ) {
    return this.charge.execute({ ...body, boletoId: id });
  }

  @Post('public/:id/pix')
  @ApiOperation({ summary: 'Gerar cobrança PIX de um boleto (checkout público)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async chargePixRoute(
    @Param('id') id: string,
    @Body() body: PublicChargeBoletoDto,
  ) {
    return this.chargePix.execute({ ...body, boletoId: id });
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar boletos' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListBoletosQueryDto,
  ): Promise<{ data: unknown; page: number; pageSize: number; total: number }> {
    return this.list.execute({ userId: user?.sub ?? '', role: user?.role ?? 'USER', query });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar boleto' })
  @ApiResponse({ status: 201, schema: { example: { data: { id: 'uuid-boleto-1' } } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async createRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreateBoletoDto,
  ): Promise<{ data: unknown }> {
    return this.create.execute({ userId: user?.sub ?? '', dto });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buscar boleto por id' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Boleto não encontrado' } } })
  async getRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ data: unknown }> {
    return this.getOne.execute({ userId: user?.sub ?? '', role: user?.role ?? 'USER', id });
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar boleto' })
  @ApiResponse({ status: 200, schema: { example: { data: { id: 'uuid-boleto-1' } } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Boleto não encontrado' } } })
  async updateRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateBoletoDto,
  ): Promise<{ data: unknown }> {
    return this.update.execute({ userId: user?.sub ?? '', role: user?.role ?? 'USER', id, dto });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover boleto' })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Boleto não encontrado' } } })
  async deleteRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.del.execute({ userId: user?.sub ?? '', role: user?.role ?? 'USER', id });
    return { deleted: true };
  }
}
