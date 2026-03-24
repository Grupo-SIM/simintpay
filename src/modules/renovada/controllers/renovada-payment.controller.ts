import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CheckoutPixDto } from '../dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../dtos/checkout-credit-card.dto';
import { PaymentNewService } from '../services/payment-new.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

const RENOVADA_USER_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

@ApiTags('Renovada Payments')
@Controller('renovada/payments')
export class RenovadaPaymentController {
  constructor(
    private readonly paymentService: PaymentNewService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('pix')
  @ApiOperation({ summary: '[RENOVADA] Criar pagamento PIX' })
  async createPix(@Body() body: CheckoutPixDto) {
    return this.paymentService.createPaymentPix(RENOVADA_USER_ID, body);
  }

  @Post('credit-card')
  @ApiOperation({ summary: '[RENOVADA] Criar pagamento com Cartão de Crédito' })
  async createCreditCard(@Body() body: CheckoutCreditCardDto) {
    return this.paymentService.createPaymentCreditCard(RENOVADA_USER_ID, body);
  }

  @Get('status/:paymentId')
  @ApiOperation({ summary: '[RENOVADA] Verificar status de pagamento por domPaymentId' })
  async checkStatus(@Param('paymentId') paymentId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        userId: RENOVADA_USER_ID,
        OR: [{ domPaymentId: paymentId }, { domTransactionId: paymentId }],
      },
      select: { domPaymentId: true, status: true },
    });

    if (!tx) return { paymentId, status: 'PENDING' };
    return { paymentId: tx.domPaymentId, status: tx.status };
  }

  @Get('test')
  @ApiOperation({ summary: '[RENOVADA] Testar endpoint de pagamentos' })
  async test() {
    return {
      message: '[RENOVADA] Payments API working',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      module: 'Renovada',
    };
  }
}
