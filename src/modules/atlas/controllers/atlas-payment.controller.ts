import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CheckoutPixDto } from '../../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../../renovada/dtos/checkout-credit-card.dto';
import { AtlasPaymentService } from '../services/atlas-payment.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@ApiTags('Atlas Payments')
@Controller('atlas/payments')
export class AtlasPaymentController {
  constructor(
    private readonly paymentService: AtlasPaymentService,
    private readonly prisma: PrismaService,
  ) {}

  private get atlasUserId(): string {
    const id = process.env.ATLAS_USER_ID;
    if (!id) throw new Error('ATLAS_USER_ID não configurado no .env');
    return id;
  }

  @Post('pix')
  @ApiOperation({ summary: '[ATLAS] Criar pagamento PIX' })
  async createPix(@Body() body: CheckoutPixDto) {
    return this.paymentService.createPaymentPix(this.atlasUserId, body);
  }

  @Post('credit-card')
  @ApiOperation({ summary: '[ATLAS] Criar pagamento com Cartão de Crédito' })
  async createCreditCard(@Body() body: CheckoutCreditCardDto) {
    return this.paymentService.createPaymentCreditCard(this.atlasUserId, body);
  }

  @Get('status/:paymentId')
  @ApiOperation({ summary: '[ATLAS] Verificar status de um pagamento' })
  async checkStatus(@Param('paymentId') paymentId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        userId: this.atlasUserId,
        OR: [{ domPaymentId: paymentId }, { domTransactionId: paymentId }],
      },
      select: { domPaymentId: true, status: true },
    });

    if (!tx) return { paymentId, status: 'NOT_FOUND' };
    return { paymentId: tx.domPaymentId, status: tx.status };
  }
}
