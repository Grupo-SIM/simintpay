import { getPlatformOwnerId } from '../../module.registry';
import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CheckoutPixDto } from '../../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../../renovada/dtos/checkout-credit-card.dto';
import { ZeroGrauPaymentService } from '../services/zero-grau-payment.service';
import { ReconcilePendingTransactionsUseCase } from '../../../application/use-cases/webhook/reconcile-pending-transactions.use-case';

@ApiTags('Zero Grau Payments')
@Controller('zero-grau/payments')
export class ZeroGrauPaymentController {
  constructor(
    private readonly paymentService: ZeroGrauPaymentService,
    private readonly reconcile: ReconcilePendingTransactionsUseCase,
  ) {}

  private get zeroGrauUserId(): string {
    const id = (getPlatformOwnerId('ZERO-GRAU') ?? '');
    if (!id) throw new Error('Plataforma Zero Grau sem dono cadastrado');
    return id;
  }

  @Post('pix')
  @ApiOperation({ summary: '[ZERO_GRAU] Criar pagamento PIX' })
  async createPix(@Body() body: CheckoutPixDto) {
    return this.paymentService.createPaymentPix(this.zeroGrauUserId, body);
  }

  @Post('credit-card')
  @ApiOperation({ summary: '[ZERO_GRAU] Criar pagamento com Cartão de Crédito' })
  async createCreditCard(@Body() body: CheckoutCreditCardDto) {
    return this.paymentService.createPaymentCreditCard(this.zeroGrauUserId, body);
  }

  @Get('status/:paymentId')
  @ApiOperation({ summary: '[ZERO_GRAU] Verificar status de um pagamento' })
  async checkStatus(@Param('paymentId') paymentId: string) {
    return this.paymentService.checkStatus(paymentId);
  }

  @Get('pix-status/:domPaymentId')
  @ApiOperation({ summary: '[ZERO_GRAU] Verificar status PIX direto na DOM (sem aguardar webhook)' })
  async checkPixStatusDirect(@Param('domPaymentId') domPaymentId: string) {
    return this.paymentService.checkPixStatusDirect(domPaymentId);
  }
}
