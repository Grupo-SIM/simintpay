/**
 * SubscriptionLinkEnController
 *
 * Alias controller com rotas em inglês (/subscription-links/...)
 * para compatibilidade com o checkout-form-generic.
 *
 * As rotas em português (/links-assinatura/...) continuam funcionando normalmente.
 * Este controller apenas remapeia os campos de resposta para inglês e aceita
 * o código do link no corpo da requisição (padrão do checkout-form).
 */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GetPublicSubscriptionLinkUseCase } from '../../application/use-cases/subscription-link/get-public-subscription-link.use-case';
import { CheckoutSubscriptionLinkCardUseCase } from '../../application/use-cases/subscription-link/checkout-subscription-link-card.use-case';
import { CheckoutSubscriptionLinkPixUseCase } from '../../application/use-cases/subscription-link/checkout-subscription-link-pix.use-case';
import type { CheckoutCardDto } from '../../application/dtos/subscription-link/checkout-subscription-link.dto';

/** Body que o checkout-form-generic envia para o checkout por cartão */
class SubscriptionLinkCheckoutCardBody {
  code!: string;
  customerName!: string;
  customerEmail!: string;
  customerDocument!: string;
  customerDocumentType?: string;
  /** A form usa customerMobilePhone — mapeado para customerPhone internamente */
  customerMobilePhone?: string;
  customerPhone?: string;
  card!: CheckoutCardDto;
}

/** Body que o checkout-form-generic envia para o checkout por PIX */
class SubscriptionLinkCheckoutPixBody {
  code!: string;
  customerName!: string;
  customerEmail!: string;
  customerDocument!: string;
  customerPhone?: string;
}

@Controller('subscription-links')
@ApiTags('Subscription Links (EN compat)')
export class SubscriptionLinkEnController {
  constructor(
    private readonly getPublicUC: GetPublicSubscriptionLinkUseCase,
    private readonly checkoutCardUC: CheckoutSubscriptionLinkCardUseCase,
    private readonly checkoutPixUC: CheckoutSubscriptionLinkPixUseCase,
  ) {}

  /**
   * GET /subscription-links/public/:code
   * Retorna dados públicos do link com campos em inglês e taxa efetiva aplicada.
   */
  @Get('public/:code')
  @ApiOperation({ summary: 'Dados públicos do link de assinatura (campos em inglês)' })
  async getPublic(@Param('code') code: string) {
    const data = await this.getPublicUC.execute(code);

    // Remapear campos para inglês (checkout-form usa esses nomes)
    return {
      id: data.id,
      code: data.codigo,
      name: data.nome,
      description: data.descricao,
      amount: data.valor,
      amountWithFee: data.valorComJuros,
      platformFee: data.platformFee,
      isStandalone: data.isStandalone,
      frequencyType: data.frequencia,
      isActive: data.ativo,
      redirectUrl: data.redirectUrl,
      paymentMethods: data.paymentMethods,
      aceitaCartao: data.aceitaCartao,
      aceitaPix: data.aceitaPix,
    };
  }

  /**
   * POST /subscription-links/checkout
   * Checkout por cartão de crédito — aceita { code, ...customerData, card } no body.
   */
  @Post('checkout')
  @ApiOperation({ summary: 'Checkout por cartão (body com code)' })
  async checkoutCard(@Body() body: SubscriptionLinkCheckoutCardBody) {
    return this.checkoutCardUC.execute({
      code: body.code,
      dto: {
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerDocument: body.customerDocument,
        // Suporta tanto customerPhone quanto customerMobilePhone
        customerPhone: body.customerPhone ?? body.customerMobilePhone,
        card: body.card,
      },
    });
  }

  /**
   * POST /subscription-links/checkout/pix
   * Checkout por PIX — aceita { code, ...customerData } no body.
   */
  @Post('checkout/pix')
  @ApiOperation({ summary: 'Checkout por PIX (body com code)' })
  async checkoutPix(@Body() body: SubscriptionLinkCheckoutPixBody) {
    return this.checkoutPixUC.execute({
      code: body.code,
      dto: {
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerDocument: body.customerDocument,
        customerPhone: body.customerPhone,
      },
    });
  }
}
