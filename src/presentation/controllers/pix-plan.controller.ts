import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PixPlanCheckoutDto } from '../../application/dtos/pix-plan/pix-plan-checkout.dto';
import { PixPlanCheckoutByCodeDto } from '../../application/dtos/pix-plan/pix-plan-checkout-by-code.dto';
import { CreatePixCreditPlanDto } from '../../application/dtos/pix-plan/create-pix-credit-plan.dto';
import { PixPlanService } from '../../application/use-cases/pix-plan/pix-plan.service';

@Controller('payments')
@ApiTags('PIX Plan')
export class PixPlanController {
  constructor(private readonly pixPlanService: PixPlanService) {}

  // ── Rotas públicas (sem autenticação) ──────────────────────────────────────

  @Get('pix-plan/link-code/:code')
  @ApiOperation({ summary: 'Obter link-code PIX-PLAN' })
  @ApiParam({ name: 'code', description: 'Código do link PIX-PLAN' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPixPlanLinkCode(@Param('code') code: string) {
    return this.pixPlanService.getPixPlanLinkCode(code);
  }

  @Get('pix-plan/link-code-details/:code/checkout')
  @ApiOperation({ summary: 'Obter detalhes de link code PIX-PLAN para checkout' })
  @ApiParam({ name: 'code', description: 'Código do link PIX-PLAN' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPixPlanLinkCodeDetailsForCheckout(@Param('code') code: string) {
    return this.pixPlanService.getPixPlanLinkCodeDetailsForCheckout(code);
  }

  // ── Rotas autenticadas ─────────────────────────────────────────────────────

  @Post('pix-plan/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar pagamento PIX para plano com crédito de dias' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 401 })
  async createPixPlanCheckout(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: PixPlanCheckoutDto,
  ) {
    return this.pixPlanService.createPixPlanPayment(user?.sub ?? '', body);
  }

  @Post('pix-plan/:id/link-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar link code para plano PIX de crédito' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async createPixPlanLinkCodeForPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.createPixPlanLinkCodeForPlan(user?.sub ?? '', id);
  }

  @Get('pix-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos os planos PIX de crédito do usuário' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  async listPixCreditPlans(@CurrentUser() user: JwtPayload | undefined) {
    return this.pixPlanService.listPixCreditPlans(user?.sub ?? '');
  }

  @Post('pix-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar plano PIX de crédito (padrão body do /plan)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 401 })
  async createPixCreditPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: CreatePixCreditPlanDto,
  ) {
    return this.pixPlanService.createPixCreditPlanFromPublicDto(user?.sub ?? '', body);
  }

  @Delete('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletar plano PIX de crédito' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX a ser deletado' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async deletePixCreditPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.deletePixCreditPlan(user?.sub ?? '', id);
  }

  @Post('pix-plan/checkout-by-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar pagamento PIX-PLAN a partir de um code' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 401 })
  async createPixPlanPaymentFromCode(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() body: PixPlanCheckoutByCodeDto,
  ) {
    return this.pixPlanService.createPixPlanPaymentFromCode(user?.sub ?? '', body);
  }

  @Get('plan-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consultar acesso do cliente ao plano (crédito de dias)' })
  @ApiQuery({ name: 'document', required: true, type: String })
  @ApiResponse({ status: 200 })
  async getPlanAccess(
    @CurrentUser() user: JwtPayload | undefined,
    @Query('document') document: string,
  ) {
    if (!document) throw new BadRequestException('Documento é obrigatório');
    return this.pixPlanService.getPlanAccess(user?.sub ?? '', document);
  }

  @Get('admin/pix-plan-access')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos os acessos ativos aos planos PIX (Admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200 })
  async listAllPixPlanAccess(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('isActive') isActive?: string,
  ) {
    let isActiveBoolean: boolean | undefined;
    if (isActive !== undefined) isActiveBoolean = isActive === 'true';

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 20;

    return this.pixPlanService.listAllPixPlanAccess({
      page: pageNumber,
      limit: limitNumber,
      userId,
      isActive: isActiveBoolean,
    });
  }

  @Post('plan-access/decrement-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Decrementar dias de todos os planos ativos (admin)' })
  @ApiResponse({ status: 200 })
  async decrementAllPlanDays() {
    return this.pixPlanService.decrementAllPlanDays();
  }
}

// ── Controller público separado ──────────────────────────────────────────────

@Controller('public')
@ApiTags('Public PIX Plan')
export class PublicPixPlanController {
  constructor(private readonly pixPlanService: PixPlanService) {}

  @Get('pix-plan-access')
  @ApiOperation({ summary: 'Listar acessos ativos aos planos PIX (Endpoint Público)' })
  @ApiQuery({ name: 'userId', required: true, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  async getPixPlanAccess(
    @Query('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isActive') isActive?: string,
  ) {
    if (!userId) throw new BadRequestException('userId é obrigatório');

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    let isActiveBoolean: boolean | undefined;
    if (isActive !== undefined) isActiveBoolean = isActive === 'true';

    return this.pixPlanService.listAllPixPlanAccess({
      page: pageNumber,
      limit: limitNumber,
      userId,
      isActive: isActiveBoolean,
    });
  }

  @Get('purchase/:transactionId')
  @ApiOperation({ summary: 'Obter detalhes de uma compra (PIX Plan ou Subscription)' })
  @ApiParam({ name: 'transactionId', required: true, type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPurchaseDetails(@Param('transactionId') transactionId: string) {
    if (!transactionId) throw new BadRequestException('transactionId é obrigatório');
    return this.pixPlanService.getPurchaseDetails(transactionId);
  }
}

// ── Controller bot ───────────────────────────────────────────────────────────

@Controller('bot')
@ApiTags('Bot PIX Plan')
export class BotPixPlanController {
  constructor(private readonly pixPlanService: PixPlanService) {}

  @Delete('pix-plan/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletar plano PIX de crédito (Bot)' })
  @ApiParam({ name: 'id', description: 'ID do plano PIX a ser deletado' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async deletePixPlan(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.pixPlanService.deletePixCreditPlan(user?.sub ?? '', id);
  }
}
