import { Controller, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ReconcilePendingTransactionsUseCase } from '../../application/use-cases/webhook/reconcile-pending-transactions.use-case';

/**
 * Endpoint interno (x-internal-token) para reconciliar transações PENDENTES contra a DOM.
 * Vive no WebhookModule (onde está o use-case) para evitar ciclo com o CheckoutModule, que
 * declara o InternalRenovadaFinanceController na mesma rota base.
 *
 * Usado pelo botão "Reconciliar" do admin-renovada12 (via proxy /api/internal que injeta o token).
 */
@Controller('internal/renovada/finance')
export class InternalReconcileController {
  constructor(private readonly reconcilePending: ReconcilePendingTransactionsUseCase) {}

  private ensureInternalToken(token?: string) {
    const expected = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  @Post('reconcile')
  async reconcile(
    @Query('userId') userId?: string,
    @Query('horas') horas?: string,
    @Headers('x-internal-token') internalToken?: string,
  ) {
    this.ensureInternalToken(internalToken);
    // Botão manual: janela ampla (30 dias) e limite maior por padrão, para pegar pendências antigas
    // travadas. O polling automático consulta apenas os primeiros 30 minutos de criação.
    const sinceHours = horas ? Math.max(1, Number(horas)) : 720;
    return this.reconcilePending.execute({ userId: userId || undefined, sinceHours, limit: 500 });
  }
}
