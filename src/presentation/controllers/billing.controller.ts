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
import {
  PAYMENT_GATEWAY_DOM,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import { getModuleDomToken } from '../../modules/module.registry';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { Inject } from '@nestjs/common';

@Controller('internal/billing')
@ApiTags('Billing interno')
@ApiHeader({ name: 'x-internal-token', required: true })
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_DOM) private readonly gateway: IPaymentGateway,
  ) {}

  /**
   * Cria a primeira assinatura mensal de um workspace antes de ele existir no
   * Teron. O resourceId é gerado pelo serviço de contas e vira o UUID do
   * workspace depois da aprovação, evitando qualquer workspace sem cobrança.
   */
  @Post('workspace-subscriptions')
  @ApiOperation({
    summary: 'Criar assinatura inicial e contrato de um workspace',
  })
  async createWorkspaceSubscription(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body()
    body: {
      billingOwnerId: string;
      accountId: string;
      resourceId: string;
      quantity: number;
      baseAmount: string;
      unitAmount: string;
      customer: {
        name: string;
        email: string;
        document: string;
        phone: string;
      };
      card: {
        token?: string;
        brand?: string;
        bin?: string;
        number: string;
        exp_month: string;
        exp_year: string;
        cvv: string;
        holder_name: string;
        holder_document: string;
      };
    },
  ) {
    this.assertInternalToken(internalToken);
    if (!Number.isInteger(body.quantity) || body.quantity < 1) {
      throw new BadRequestException(
        'quantity deve ser um inteiro maior que zero',
      );
    }
    if (
      !body.resourceId ||
      !body.customer?.email ||
      !body.customer?.document ||
      !body.card?.number
    ) {
      throw new BadRequestException('Dados de cobrança incompletos');
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: body.billingOwnerId },
      select: {
        domToken: true,
        clientStatus: true,
        tenantModule: { select: { slug: true } },
      },
    });
    if (!owner)
      throw new BadRequestException(
        'Dono de cobrança Simintpay não encontrado',
      );
    const domToken = owner.clientStatus
      ? process.env.DOM_TOKEN
      : (owner.domToken ??
        getModuleDomToken(owner.tenantModule?.slug) ??
        process.env.DOM_TOKEN);
    if (!domToken) throw new BadRequestException('DOM_TOKEN não configurado');

    const recurringAmount =
      Number(body.baseAmount) + Number(body.unitAmount) * body.quantity;
    if (!Number.isFinite(recurringAmount) || recurringAmount <= 0) {
      throw new BadRequestException('Preço recorrente inválido');
    }

    const plan = await this.gateway.createPlan(domToken, {
      price: recurringAmount,
      description: `Teron workspace (${body.quantity} integrantes) [TENANT:TERON]`,
      frequency_type: 'MONTH',
      frequency: 1,
      repetitions: 0,
      retry_days: 3,
    });
    const document = body.customer.document.replace(/\D/g, '');
    const subscription = await this.gateway.createSubscriptionFromCheckout(
      domToken,
      {
        planId: plan.id,
        customer: {
          name: body.customer.name,
          email: body.customer.email,
          document,
          phone: body.customer.phone.replace(/\D/g, ''),
          documentType: document.length === 14 ? 'CNPJ' : 'CPF',
        },
        card: { ...body.card, token: body.card.token ?? '' },
      },
    );
    const snapshot = await this.gateway.getSubscriptionBillingSnapshot(
      domToken,
      subscription.id,
    );
    if (snapshot.status.toLowerCase() !== 'active' || !snapshot.nextInvoiceAt) {
      throw new BadRequestException(
        'O pagamento ainda não foi aprovado pelo gateway',
      );
    }

    const now = new Date();
    const contract = await this.billing.createContract({
      userId: body.billingOwnerId,
      resourceType: 'WORKSPACE',
      resourceId: body.resourceId,
      externalSubscriptionId: subscription.id,
      baseAmount: body.baseAmount,
      unitAmount: body.unitAmount,
      quantity: body.quantity,
      minimumQuantity: 1,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: snapshot.nextInvoiceAt,
      priceKey: 'TERON_WORKSPACE',
      pricingVersion: 1,
      description: `Teron workspace (${body.quantity} integrantes)`,
      metadata: {
        teronAccountId: body.accountId,
        workspaceId: body.resourceId,
      },
    });
    return {
      contractId: contract.id,
      externalSubscriptionId: contract.externalSubscriptionId,
      currentPeriodStart: contract.currentPeriodStart,
      currentPeriodEnd: contract.currentPeriodEnd,
    };
  }

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
