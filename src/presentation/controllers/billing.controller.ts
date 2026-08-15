import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from '../../application/use-cases/billing/billing.service';
import { CreateBillingContractDto } from '../../application/dtos/billing/create-billing-contract.dto';
import { ChangeBillingQuantityDto } from '../../application/dtos/billing/change-billing-quantity.dto';

@Controller('internal/billing')
@ApiTags('Billing interno')
@ApiHeader({ name: 'x-internal-token', required: true })
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('contracts')
  @ApiOperation({
    summary: 'Registrar contrato genérico sobre uma assinatura DOM ativa',
  })
  createContract(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body() dto: CreateBillingContractDto,
  ) {
    this.assertInternalToken(internalToken);
    return this.billing.createContract(dto);
  }

  @Get('contracts/by-resource/:resourceType/:resourceId')
  @ApiOperation({ summary: 'Consultar contrato pelo recurso faturável' })
  findByResource(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
  ) {
    this.assertInternalToken(internalToken);
    return this.billing.findByResource(resourceType, resourceId);
  }

  @Get('contracts/:contractId')
  @ApiOperation({ summary: 'Consultar contrato genérico de cobrança' })
  getContract(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Param('contractId') contractId: string,
  ) {
    this.assertInternalToken(internalToken);
    return this.billing.getContract(contractId);
  }

  @Post('contracts/:contractId/quantity-changes')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Alterar quantidade com pró-rata e recorrência futura',
  })
  changeQuantity(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-idempotency-key') alternativeIdempotencyKey: string | undefined,
    @Param('contractId') contractId: string,
    @Body() dto: ChangeBillingQuantityDto,
  ) {
    this.assertInternalToken(internalToken);
    const key = (idempotencyKey ?? alternativeIdempotencyKey)?.trim();
    if (!key || key.length > 191) {
      throw new BadRequestException(
        'Idempotency-Key obrigatória e deve ter até 191 caracteres',
      );
    }
    return this.billing.requestQuantityChange(contractId, key, dto);
  }

  @Get('contracts/:contractId/quantity-changes/:changeId')
  @ApiOperation({ summary: 'Consultar mudança de quantidade' })
  getChange(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Param('contractId') contractId: string,
    @Param('changeId') changeId: string,
  ) {
    this.assertInternalToken(internalToken);
    return this.billing.getChange(contractId, changeId);
  }

  @Post('contracts/:contractId/quantity-changes/:changeId/reconcile')
  @ApiOperation({ summary: 'Retomar cobrança/migração pendente imediatamente' })
  reconcileChange(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Param('contractId') contractId: string,
    @Param('changeId') changeId: string,
  ) {
    this.assertInternalToken(internalToken);
    return this.billing.reconcileChange(contractId, changeId);
  }

  private assertInternalToken(received: string | undefined): void {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || !received || received !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }
}
