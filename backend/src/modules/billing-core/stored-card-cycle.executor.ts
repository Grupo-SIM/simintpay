import { Injectable, Logger } from '@nestjs/common';
import type { BillingContract, Charge } from '@prisma/client';
import { toAcquirer } from '../../core/services/acquirer.enum';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../infrastructure/http/payment-gateway.resolver';
import { getModuleDomToken } from '../module.registry';
import type {
  CycleChargeExecutor,
  CycleChargeOutcome,
} from './billing-cycle.service';
import { StoredCardVaultService } from './stored-card-vault.service';

const PAID = new Set([
  'paid',
  'approved',
  'captured',
  'completed',
  'authorized',
]);
const REFUSED = new Set([
  'refused',
  'denied',
  'declined',
  'failed',
  'canceled',
  'cancelled',
  'rejected',
  'error',
]);

/** Status do adquirente -> resultado. Qualquer coisa fora dos conjuntos acima (pending, processing...) é UNKNOWN. */
export function outcomeFromGatewayStatus(status: string): CycleChargeOutcome {
  const s = status.trim().toLowerCase();
  if (PAID.has(s)) return 'PAID';
  if (REFUSED.has(s)) return 'FAILED';
  return 'UNKNOWN';
}

/** Recusa definitiva do adquirente (HTTP 4xx, exceto timeout/limite) é FAILED; o resto é ambíguo. */
function isDefiniteRejection(error: unknown): boolean {
  const e = error as { response?: { status?: number }; status?: number };
  const status = e?.response?.status ?? e?.status;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

/**
 * Cobra o ciclo no cartão guardado, sem o comprador. A chave de idempotência deriva de
 * charge.id + attempts: repetir a mesma tentativa após timeout não cobra duas vezes,
 * e falha ambígua vira UNKNOWN (cobrança segue PENDING; nunca paga nem falha por palpite).
 *
 * Lacuna conhecida: a liquidação aqui só atualiza Charge/contrato; a `Transaction`
 * financeira (taxas, ledger) ainda não é criada para ciclos próprios.
 */
@Injectable()
export class StoredCardCycleExecutor implements CycleChargeExecutor {
  private readonly logger = new Logger(StoredCardCycleExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: StoredCardVaultService,
    private readonly gateways: PaymentGatewayResolver,
  ) {}

  canCharge(contract: BillingContract): boolean {
    const acquirer = toAcquirer(contract.acquirer);
    return (
      this.gateways.capabilitiesFor(acquirer).chargeStoredCard &&
      typeof this.gateways.byAcquirer(acquirer).chargeStoredCardToken ===
        'function'
    );
  }

  static idempotencyKey(charge: Pick<Charge, 'id' | 'attempts'>): string {
    return `cycle:${charge.id}:${charge.attempts}`;
  }

  async charge(input: {
    charge: Charge;
    contract: BillingContract;
  }): Promise<{ outcome: CycleChargeOutcome }> {
    const { charge, contract } = input;
    // Adquirente sem suporte não é culpa do comprador: não falha o ciclo nem suspende o contrato.
    if (!this.canCharge(contract)) return { outcome: 'UNKNOWN' };
    const acquirer = toAcquirer(contract.acquirer);
    const gateway = this.gateways.byAcquirer(acquirer);
    const stored = await this.vault.resolveForContract(contract.id, acquirer);
    if (!stored) return { outcome: 'FAILED' };
    const sellerToken = await this.resolveToken(contract.userId);
    if (!sellerToken) return { outcome: 'UNKNOWN' };
    const key = StoredCardCycleExecutor.idempotencyKey(charge);
    try {
      const payment = await gateway.chargeStoredCardToken!(sellerToken, {
        cardToken: stored.token,
        amount: charge.amountCents / 100,
        description: `Assinatura ${contract.description ?? contract.id}`.slice(
          0,
          80,
        ),
        codExternal: key,
        idempotencyKey: key,
      });
      return { outcome: outcomeFromGatewayStatus(payment.status) };
    } catch (error) {
      if (isDefiniteRejection(error)) return { outcome: 'FAILED' };
      this.logger.warn(
        `Cobrança ${charge.id} tentativa ${charge.attempts} sem resposta conclusiva; mantida PENDING`,
      );
      return { outcome: 'UNKNOWN' };
    }
  }

  private async resolveToken(userId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        domToken: true,
        clientStatus: true,
        platform: { select: { tag: true } },
      },
    });
    if (!user) return undefined;
    return user.clientStatus
      ? process.env.DOM_TOKEN
      : (user.domToken ??
          getModuleDomToken(user.platform?.tag) ??
          process.env.DOM_TOKEN);
  }
}
