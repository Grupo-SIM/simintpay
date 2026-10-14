import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { PlatformBetaiService } from '../../modules/platform-core/platform-betai.service';

/** Legacy authentication and response contract; all business operations delegate. */
@Controller('internal/betai')
export class InternalBetaiController {
  constructor(private readonly betai: PlatformBetaiService) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) throw new UnauthorizedException('Token interno inválido');
  }

  @Post('cobranca')
  @ApiOperation({ summary: 'Betai: cria um link de pagamento (mensalidade) + Cobranca PAYABLE' })
  criarCobranca(@Body() body: { valor: number; titulo?: string; dueDate?: string; email?: string }, @Headers('x-internal-token') token?: string) {
    this.ensureInternalToken(token);
    return this.betai.createBill(undefined, { amountCents: this.betai.legacyCents(body?.valor), title: body?.titulo, dueDate: body?.dueDate, email: body?.email });
  }

  @Post('plano')
  @ApiOperation({ summary: 'Betai: cria um plano de assinatura mensal (por faixa de valor)' })
  criarPlano(@Body() body: { valor: number; label?: string }, @Headers('x-internal-token') token?: string) {
    this.ensureInternalToken(token); return this.betai.createPlan(body);
  }

  @Post('plano/cancelar')
  @ApiOperation({ summary: 'Betai: cancela um plano' })
  cancelarPlano(@Body() body: { code?: string }, @Headers('x-internal-token') token?: string) {
    this.ensureInternalToken(token); return this.betai.cancelPlan(undefined, String(body?.code ?? '').trim());
  }

  @Get('cobranca/:code/status')
  @ApiOperation({ summary: 'Betai: status de pagamento de um link (mensalidade)' })
  statusCobranca(@Param('code') code: string, @Headers('x-internal-token') token?: string) {
    this.ensureInternalToken(token); return this.betai.status(undefined, code);
  }
}
