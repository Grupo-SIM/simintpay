import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { CreatePlanDto } from '../../application/dtos/plan/create-plan.dto';
import { CreatePlanUseCase } from '../../application/use-cases/plan/create-plan.use-case';
import { ListPlansUseCase } from '../../application/use-cases/plan/list-plans.use-case';
import { GetPlanByIdUseCase } from '../../application/use-cases/plan/get-plan-by-id.use-case';
import { UpdatePlanUseCase } from '../../application/use-cases/plan/update-plan.use-case';
import { DeletePlanUseCase } from '../../application/use-cases/plan/delete-plan.use-case';
import { GetPublicPlanUseCase } from '../../application/use-cases/plan/get-public-plan.use-case';
import { CreatePublicSubscriptionUseCase, CreatePublicSubscriptionInput } from '../../application/use-cases/plan/create-public-subscription.use-case';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('planos')
@ApiTags('Planos')
export class PlanController {
  constructor(
    private readonly list: ListPlansUseCase,
    private readonly create: CreatePlanUseCase,
    private readonly getById: GetPlanByIdUseCase,
    private readonly update: UpdatePlanUseCase,
    private readonly del: DeletePlanUseCase,
    private readonly getPublic: GetPublicPlanUseCase,
    private readonly createPublicSub: CreatePublicSubscriptionUseCase,
  ) {}

  // ── Rotas públicas (sem autenticação) ──────────────────────────────────────

  @Get('public/:id')
  @ApiOperation({ summary: 'Detalhes públicos de um plano (checkout)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPublicPlanRoute(@Param('id') id: string) {
    return this.getPublic.execute(id);
  }

  @Post('public/:id/subscribe')
  @ApiOperation({ summary: 'Criar assinatura via checkout público' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async createPublicSubscriptionRoute(
    @Param('id') id: string,
    @Body() body: Omit<CreatePublicSubscriptionInput, 'planId'>,
  ) {
    return this.createPublicSub.execute({ ...body, planId: id });
  }

  // ── Rotas autenticadas ─────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar planos' })
  @ApiResponse({ status: 200, schema: { example: { data: [{ id: 'uuid-plan-1', description: 'Plano Mensal', price: 99.9 }] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    return this.list.execute({ userId: user?.sub ?? '', role: user?.role ?? 'USER' });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar plano' })
  @ApiBody({
    type: CreatePlanDto,
    examples: {
      default: {
        value: {
          nome: 'Plano Mensal',
          descricao: 'Assinatura mensal',
          preco: 99.9,
          tipo: 'MENSAL',
          webhookUrl: 'https://exemplo.com/webhook',
          redirectUrl: 'https://exemplo.com/obrigado',
        },
      },
    },
  })
  @ApiResponse({ status: 201, schema: { example: { data: { id: 'uuid-plan-1' } } } })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['tipo must be one of the following values: MENSAL, TRIMESTRAL, SEMESTRAL, ANUAL'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async createRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreatePlanDto,
  ): Promise<{ data: unknown }> {
    return this.create.execute({ userId: user?.sub ?? '', dto });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalhe de um plano' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 401 })
  async getByIdRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ data: unknown }> {
    return this.getById.execute({ userId: user?.sub ?? '', role: user?.role ?? 'USER', id });
  }

  @Post(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar plano' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 401 })
  async updateRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: Partial<CreatePlanDto>,
  ): Promise<{ data: unknown }> {
    return this.update.execute({ userId: user?.sub ?? '', role: user?.role ?? 'USER', id, dto });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover plano' })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Plano não encontrado' } } })
  async deleteRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.del.execute({ userId: user?.sub ?? '', id });
    return { deleted: true };
  }
}
