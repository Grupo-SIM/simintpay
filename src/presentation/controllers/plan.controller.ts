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
import { DeletePlanUseCase } from '../../application/use-cases/plan/delete-plan.use-case';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('planos')
@UseGuards(JwtAuthGuard)
@ApiTags('Planos')
@ApiBearerAuth()
export class PlanController {
  constructor(
    private readonly list: ListPlansUseCase,
    private readonly create: CreatePlanUseCase,
    private readonly del: DeletePlanUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar planos' })
  @ApiResponse({ status: 200, schema: { example: { data: [{ id: 'uuid-plan-1', description: 'Plano Mensal', price: 99.9 }] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    return this.list.execute({ userId: user?.sub ?? '' });
  }

  @Post()
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

  @Delete(':id')
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
