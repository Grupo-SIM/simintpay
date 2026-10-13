import { Controller, Post, Body, Get, Param, NotFoundException } from '@nestjs/common';
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

  private async ownerUserId(): Promise<string> {
    const platform = await this.prisma.platform.findFirst({
      where: { tag: { equals: 'atlas', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
    });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada com dono no admin.');
    return platform.ownerUserId;
  }

  @Post('pix')
  @ApiOperation({ summary: '[ATLAS] Criar pagamento PIX' })
  async createPix(@Body() body: CheckoutPixDto) {
    return this.paymentService.createPaymentPix(await this.ownerUserId(), body);
  }

  @Post('credit-card')
  @ApiOperation({ summary: '[ATLAS] Criar pagamento com Cartão de Crédito' })
  async createCreditCard(@Body() body: CheckoutCreditCardDto) {
    return this.paymentService.createPaymentCreditCard(await this.ownerUserId(), body);
  }

  @Get('status/:paymentId')
  @ApiOperation({ summary: '[ATLAS] Verificar status de um pagamento' })
  async checkStatus(@Param('paymentId') paymentId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        userId: await this.ownerUserId(),
        OR: [{ domPaymentId: paymentId }, { domTransactionId: paymentId }],
      },
      select: { domPaymentId: true, status: true },
    });

    if (!tx) return { paymentId, status: 'NOT_FOUND' };
    return { paymentId: tx.domPaymentId, status: tx.status };
  }

  @Get('pix-status/:domPaymentId')
  @ApiOperation({ summary: '[ATLAS] Verificar status PIX direto na DOM (sem aguardar webhook)' })
  async checkPixStatusDirect(@Param('domPaymentId') domPaymentId: string) {
    return this.paymentService.checkPixStatusDirect(domPaymentId);
  }
}
