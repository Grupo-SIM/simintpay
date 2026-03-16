import { Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListSubscribersQueryDto } from '../../application/dtos/subscription/list-subscribers.query.dto';
import { ListSubscribersUseCase } from '../../application/use-cases/subscription/list-subscribers.use-case';
import { CancelSubscriptionUseCase } from '../../application/use-cases/subscription/cancel-subscription.use-case';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('assinantes')
@UseGuards(JwtAuthGuard)
@ApiTags('Assinantes')
@ApiBearerAuth()
export class SubscriptionController {
  constructor(
    private readonly listSubscribers: ListSubscribersUseCase,
    private readonly cancel: CancelSubscriptionUseCase,
  ) {}

  @Get('assinantes')
  @ApiOperation({ summary: 'Listar assinantes' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [{ id: 'uuid-sub-1', status: 'ACTIVE', planoId: 'uuid-plan-1' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    },
  })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['page must not be less than 1'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async listSubscribersRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListSubscribersQueryDto,
  ): Promise<{ data: unknown; page: number; pageSize: number; total: number }> {
    return this.listSubscribers.execute({ userId: user?.sub ?? '', query });
  }

  @Put('subscription/:id/cancel')
  @ApiOperation({ summary: 'Cancelar assinatura' })
  @ApiResponse({ status: 200, schema: { example: { cancelled: true } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Assinatura não encontrada' } } })
  async cancelRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ cancelled: true }> {
    await this.cancel.execute({ userId: user?.sub ?? '', id });
    return { cancelled: true };
  }
}
