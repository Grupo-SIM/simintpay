import { Controller, Post, Body, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CheckoutPixDto } from '../dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../dtos/checkout-credit-card.dto';
import { BosquePaymentService } from '../services/bosque-payment.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@ApiTags('Bosque Payments')
@Controller('bosque/payments')
export class BosquePaymentController {
  constructor(
    private readonly paymentService: BosquePaymentService,
    private readonly prisma: PrismaService,
  ) {}

  private async ownerUserId(): Promise<string> {
    const platform = await this.prisma.platform.findFirst({
      where: { tag: { equals: 'bosque', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
    });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada com dono no admin.');
    return platform.ownerUserId;
  }

  @Post('pix')
  @ApiOperation({ summary: '[BOSQUE] Criar pagamento PIX' })
  async createPix(@Body() body: CheckoutPixDto) {
    return this.paymentService.createPaymentPix(await this.ownerUserId(), body);
  }

  @Post('credit-card')
  @ApiOperation({ summary: '[BOSQUE] Criar pagamento com Cartão de Crédito' })
  async createCreditCard(@Body() body: CheckoutCreditCardDto) {
    return this.paymentService.createPaymentCreditCard(await this.ownerUserId(), body);
  }

  @Get('status/:paymentId')
  @ApiOperation({ summary: '[BOSQUE] Verificar status de pagamento por domPaymentId' })
  async checkStatus(@Param('paymentId') paymentId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        userId: await this.ownerUserId(),
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
