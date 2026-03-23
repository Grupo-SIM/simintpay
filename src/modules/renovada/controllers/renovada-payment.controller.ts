import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../infrastructure/security/guards/jwt-auth.guard';
import { CheckoutPixDto } from '../dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../dtos/checkout-credit-card.dto';
import { PaymentNewService } from '../services/payment-new.service';
import { CurrentUser } from '../../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../../infrastructure/security/strategies/jwt.strategy';

@ApiTags('Renovada Payments')
@ApiBearerAuth()
@Controller('renovada/payments')
@UseGuards(JwtAuthGuard)
export class RenovadaPaymentController {
  constructor(private readonly paymentService: PaymentNewService) {}

  @Post('pix')
  @ApiOperation({ summary: '[RENOVADA] Criar pagamento PIX' })
  async createPix(
    @Body() body: CheckoutPixDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentService.createPaymentPix(user.sub, body);
  }

  @Post('credit-card')
  @ApiOperation({ summary: '[RENOVADA] Criar pagamento com Cartão de Crédito' })
  async createCreditCard(
    @Body() body: CheckoutCreditCardDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentService.createPaymentCreditCard(user.sub, body);
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
