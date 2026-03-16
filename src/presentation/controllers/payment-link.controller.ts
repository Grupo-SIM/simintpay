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
import { CreatePaymentLinkDto } from '../../application/dtos/payment-link/create-payment-link.dto';
import { UpdatePaymentLinkDto } from '../../application/dtos/payment-link/update-payment-link.dto';
import { ListPaymentLinksQueryDto } from '../../application/dtos/payment-link/list-payment-links.query.dto';
import { CreatePaymentLinkUseCase } from '../../application/use-cases/payment-link/create-payment-link.use-case';
import { ListPaymentLinksUseCase } from '../../application/use-cases/payment-link/list-payment-links.use-case';
import { GetPaymentLinkUseCase } from '../../application/use-cases/payment-link/get-payment-link.use-case';
import { UpdatePaymentLinkUseCase } from '../../application/use-cases/payment-link/update-payment-link.use-case';
import { DeletePaymentLinkUseCase } from '../../application/use-cases/payment-link/delete-payment-link.use-case';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('links-pagamento')
@UseGuards(JwtAuthGuard)
@ApiTags('Links de Pagamento')
@ApiBearerAuth()
export class PaymentLinkController {
  constructor(
    private readonly create: CreatePaymentLinkUseCase,
    private readonly list: ListPaymentLinksUseCase,
    private readonly getOne: GetPaymentLinkUseCase,
    private readonly update: UpdatePaymentLinkUseCase,
    private readonly del: DeletePaymentLinkUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar links de pagamento' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [{ id: 'uuid-link-1', title: 'Plano Mensal', amount: 9900 }],
        page: 1,
        pageSize: 10,
        total: 1,
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListPaymentLinksQueryDto,
  ): Promise<{ data: unknown; page: number; pageSize: number; total: number }> {
    return this.list.execute({ userId: user?.sub ?? '', query });
  }

  @Post()
  @ApiOperation({ summary: 'Criar link de pagamento' })
  @ApiBody({
    type: CreatePaymentLinkDto,
    examples: {
      default: {
        value: {
          titulo: 'Plano Mensal',
          descricao: 'Assinatura mensal',
          valor: 99.9,
          parcelasMax: 12,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    schema: { example: { data: { id: 'uuid-link-1' } } },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: { statusCode: 400, message: ['valor must be a number conforming to the specified constraints'] },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async createRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreatePaymentLinkDto,
  ): Promise<{ data: unknown }> {
    return this.create.execute({ userId: user?.sub ?? '', dto });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar link de pagamento por id' })
  @ApiResponse({
    status: 200,
    schema: { example: { data: { id: 'uuid-link-1', title: 'Plano Mensal', amount: 9900 } } },
  })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Link não encontrado' } } })
  async getRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ data: unknown }> {
    return this.getOne.execute({ userId: user?.sub ?? '', id });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar link de pagamento' })
  @ApiBody({
    type: UpdatePaymentLinkDto,
    examples: {
      default: {
        value: {
          titulo: 'Plano Mensal (Atualizado)',
          valor: 109.9,
          parcelasMax: 10,
          isActive: true,
        },
      },
    },
  })
  @ApiResponse({ status: 200, schema: { example: { data: { id: 'uuid-link-1' } } } })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['parcelasMax must not be greater than 12'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Link não encontrado' } } })
  async updateRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkDto,
  ): Promise<{ data: unknown }> {
    return this.update.execute({ userId: user?.sub ?? '', id, dto });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover link de pagamento' })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  @ApiResponse({ status: 404, schema: { example: { statusCode: 404, message: 'Link não encontrado' } } })
  async deleteRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.del.execute({ userId: user?.sub ?? '', id });
    return { deleted: true };
  }
}
