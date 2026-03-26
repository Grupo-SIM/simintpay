import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CheckoutPixDto } from '../dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../dtos/checkout-credit-card.dto';
import { BosquePaymentService } from '../services/bosque-payment.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

const BOSQUE_USER_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

@ApiTags('Bosque Payments')
@Controller('bosque/payments')
export class BosquePaymentController {
  constructor(
    private readonly paymentService: BosquePaymentService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('pix')
  @ApiOperation({ summary: '[BOSQUE] Criar pagamento PIX' })
  async createPix(@Body() body: CheckoutPixDto) {
    return this.paymentService.createPaymentPix(BOSQUE_USER_ID, body);
  }

  @Post('credit-card')
  @ApiOperation({ summary: '[BOSQUE] Criar pagamento com Cartão de Crédito' })
  async createCreditCard(@Body() body: CheckoutCreditCardDto) {
    return this.paymentService.createPaymentCreditCard(BOSQUE_USER_ID, body);
  }

  @Get('status/:paymentId')
  @ApiOperation({ summary: '[BOSQUE] Verificar status de pagamento por domPaymentId' })
  async checkStatus(@Param('paymentId') paymentId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        userId: BOSQUE_USER_ID,
        OR: [{ domPaymentId: paymentId }, { domTransactionId: paymentId }],
      },
      select: { domPaymentId: true, status: true },
    });

    if (!tx) return { paymentId, status: 'PENDING' };
    return { paymentId: tx.domPaymentId, status: tx.status };
  }

  @Get('test')
  @ApiOperation({ summary: '[BOSQUE] Testar endpoint de pagamentos' })
  async test() {
    return {
      message: '[BOSQUE] Payments API working',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      module: 'Bosque',
    };
  }
}
