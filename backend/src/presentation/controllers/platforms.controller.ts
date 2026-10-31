import type { AdditiveFeeInput } from '../../modules/additive-fees/additive-fees.service';
import type { SimulationInput } from '../../modules/financial-policy/financial-policy.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformsService } from '../../application/services/platforms.service';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';

@ApiTags('Platforms')
@ApiBearerAuth()
@Controller('platforms')
@UseGuards(JwtAuthGuard)
export class PlatformsController {
  constructor(private readonly platforms: PlatformsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar plataformas próprias; administrador lista todas',
  })
  list(@CurrentUser() user: JwtPayload) {
    return this.platforms.list(user);
  }

  @Get('owned')
  @ApiOperation({
    summary:
      'Listar somente plataformas próprias, inclusive para administrador',
  })
  owned(@CurrentUser() user: JwtPayload) {
    return this.platforms.list(user, true);
  }

  @Get('additive-fees')
  @ApiOperation({
    summary: 'Catálogo global de taxas aditivas (administrador)',
  })
  additiveFees(@CurrentUser() user: JwtPayload) {
    return this.platforms.additiveFees(user);
  }

  @Post('additive-fees')
  createAdditiveFee(
    @CurrentUser() user: JwtPayload,
    @Body() body: AdditiveFeeInput,
  ) {
    return this.platforms.createAdditiveFee(user, body);
  }

  @Patch('additive-fees/:id')
  updateAdditiveFee(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: AdditiveFeeInput,
  ) {
    return this.platforms.updateAdditiveFee(user, id, body);
  }

  @Delete('additive-fees/:id')
  @HttpCode(204)
  deleteAdditiveFee(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.platforms.deleteAdditiveFee(user, id);
  }

  @Get('acquirers')
  acquirers(@CurrentUser() user: JwtPayload) {
    return this.platforms.acquirers(user);
  }

  @Get('integration-diagnostics')
  integrationDiagnostics(@CurrentUser() user: JwtPayload) {
    return this.platforms.integrationDiagnostics(user);
  }

  @Post()
  @ApiOperation({
    summary: 'Criar plataforma própria; administrador pode atribuir dono',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { tag?: string; name?: string; ownerUserId?: string },
  ) {
    return this.platforms.create(user, body);
  }

  @Get(':tag/financial-policy')
  financialPolicy(@Param('tag') tag: string, @CurrentUser() user: JwtPayload) {
    return this.platforms.financialPolicy(tag, user);
  }

  @Patch(':tag/financial-policy')
  saveFinancialPolicy(
    @Param('tag') tag: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: unknown,
  ) {
    return this.platforms.saveFinancialPolicy(tag, user, body);
  }

  @Post(':tag/financial-policy/simulation')
  simulateFinancialPolicy(
    @Param('tag') tag: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: SimulationInput,
  ) {
    return this.platforms.simulateFinancialPolicy(tag, user, body);
  }

  @Delete(':tag')
  @ApiOperation({
    summary:
      'Excluir plataforma própria; administrador pode excluir qualquer plataforma',
  })
  remove(@Param('tag') tag: string, @CurrentUser() user: JwtPayload) {
    return this.platforms.remove(tag, user);
  }

  @Patch(':tag')
  @ApiOperation({
    summary: 'Editar plataforma; transferência exclusiva do administrador',
  })
  update(
    @Param('tag') tag: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      name?: string;
      isActive?: boolean;
      ownerUserId?: string;
      acquirer?: 'DOM' | 'FRENDZ';
      absorbCustomerInterest?: boolean;
    },
  ) {
    return this.platforms.update(tag, user, body);
  }
  @Patch(':tag/customer-interest-rates')
  @ApiOperation({
    summary: 'Definir juros cobrados do comprador por parcela (decimal)',
  })
  rates(
    @Param('tag') tag: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { rates?: Record<string, unknown>; absorbCustomerInterest?: boolean },
  ) {
    return this.platforms.patchCustomerInterestRates(tag, user, body);
  }

  @Post(':tag/customer-interest-rates/simulation')
  @ApiOperation({ summary: 'Simular rascunho de juros sem salvar alterações' })
  simulateDraft(
    @Param('tag') tag: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      amount?: unknown;
      rates?: Record<string, unknown>;
      absorbCustomerInterest?: boolean;
    },
  ) {
    return this.platforms.simulateDraft(tag, user, body);
  }

  @Get(':tag/customer-interest-rates/simulation')
  @ApiOperation({
    summary: 'Simular valor cobrado, custos e líquido por parcela',
  })
  simulate(
    @Param('tag') tag: string,
    @CurrentUser() user: JwtPayload,
    @Query('amount') amount: string,
  ) {
    return this.platforms.simulate(tag, user, amount);
  }
}
