import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BillingContract, Charge, Offer } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { recordCyclePayment, type CyclePaymentDetails } from './cycle-ledger';
import { advanceContractForCharge } from './contract-advance';
import {
  buyerPaidCycleMethod,
  effectiveRenewalMode,
  type EffectiveRenewalMode,
} from './effective-renewal-mode';
import {
  defaultCycleMethod,
  frozenQuoteFrom,
  frozenQuoteSnapshot,
  priceOfferCycle,
} from './cycle-pricing';

/**
 * PAID/FAILED são resultados definitivos do adquirente. UNKNOWN (timeout, 5xx,
 * status pendente) deixa a cobrança PENDING e o contrato intacto: nunca paga nem falha por palpite.
 */
export type CycleChargeOutcome = 'PAID' | 'FAILED' | 'UNKNOWN';

/** Cobra um ciclo no cartão guardado. Implementada pelo cofre de cartões + adquirente. */
export interface CycleChargeExecutor {
  /** Quando existe e retorna false, o contrato vira pago pelo comprador (adquirente sem cobrança de cartão guardado). */
  canCharge?(contract: BillingContract): boolean;
  charge(input: {
    charge: Charge;
    contract: BillingContract;
  }): Promise<{ outcome: CycleChargeOutcome }>;
}

export type CycleRunResult = {
  issued: number;
  autoPaid: number;
  autoFailed: number;
  awaitingBuyer: number;
  /** Cobranças automáticas sem resposta conclusiva do adquirente; seguem PENDING. */
  unknown: number;
  expired: number;
  /**
   * Contratos de oferta AUTO_CHARGE tratados como pagos pelo comprador (sem cartão utilizável
   * ou adquirente sem cobrança de cartão guardado). Já contados em `awaitingBuyer`/`expired`.
   */
  buyerPaidFallback: number;
};

type ContractWithOffer = BillingContract & { offer: Offer };

/**
 * Agenda de recorrência da SimIntPay. O adquirente só executa cobranças avulsas;
 * ciclos, tentativas, carência e suspensão vivem aqui. Cada ciclo é idempotente
 * por (contractId, cycleKey).
 */
@Injectable()
export class BillingCycleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria o contrato do comprador e a cobrança do primeiro ciclo. O acesso só começa quando ela é paga. */
  async subscribe(input: {
    offerId: string;
    customerName: string;
    customerEmail: string;
    customerDocument?: string;
    now?: Date;
  }): Promise<{ contract: BillingContract; charge: Charge }> {
    const now = input.now ?? new Date();
    const offer = await this.prisma.offer.findUniqueOrThrow({
      where: { id: input.offerId },
    });
    if (!offer.isActive) throw new Error('Oferta inativa');
    if (offer.renewalMode === 'NONE') throw new Error('Oferta sem recorrência');
    if (!offer.intervalType || !offer.intervalCount) {
      throw new Error('Oferta recorrente sem intervalo');
    }
    const email = input.customerEmail.trim().toLowerCase();
    const trialEnd = new Date(
      now.getTime() + (offer.trialDays ?? 0) * 24 * 60 * 60 * 1000,
    );
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.billingContract.create({
        data: {
          userId: offer.ownerUserId,
          resourceType: 'OFFER',
          resourceId: `${offer.id}:${email}`,
          unitAmount: new Prisma.Decimal(offer.amountCents).div(100),
          quantity: 1,
          intervalType: offer.intervalType!,
          intervalCount: offer.intervalCount!,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
          status: 'INACTIVE',
          offerId: offer.id,
          nextChargeAt: trialEnd,
          customerName: input.customerName,
          customerEmail: email,
          customerDocument: input.customerDocument ?? null,
        },
      });
      const charge = await tx.charge.create({
        data: {
          offerId: offer.id,
          contractId: contract.id,
          ownerUserId: offer.ownerUserId,
          amountCents: offer.amountCents,
          currency: offer.currency,
          dueAt: trialEnd,
          cycleKey: trialEnd.toISOString(),
          customerName: input.customerName,
          customerEmail: email,
          customerDocument: input.customerDocument ?? null,
        },
      });
      return { contract, charge };
    });
  }

  /**
   * Aplica o resultado de uma cobrança. Idempotente: só a primeira liquidação de uma
   * cobrança PENDING altera o contrato; repetições (webhook duplicado) retornam sem efeito.
   */
  async settle(
    chargeId: string,
    outcome: 'PAID' | 'FAILED',
    now: Date = new Date(),
    details: CyclePaymentDetails = {},
  ): Promise<{ applied: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.charge.updateMany({
          where: { id: chargeId, status: 'PENDING' },
          data:
            outcome === 'PAID'
              ? { status: 'PAID', paidAt: now }
              : { status: 'FAILED' },
        });
        if (claimed.count === 0) return { applied: false };
        const charge = await tx.charge.findUniqueOrThrow({
          where: { id: chargeId },
        });
        // Same transaction as the claim: Transaction, fee/coproduction snapshot and wallet credit
        // commit together with PENDING->PAID, so a duplicate settle can never credit twice.
        if (outcome === 'PAID' && charge.offerId && !details.alreadyBooked) {
          const chargedOffer = await tx.offer.findUniqueOrThrow({
            where: { id: charge.offerId },
          });
          await recordCyclePayment(tx, charge, chargedOffer, details);
        }
        await advanceContractForCharge(tx, charge, outcome, now);
        return { applied: true };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /**
   * Emite as cobranças dos contratos vencidos. Cartão salvo é cobrado pelo `executor`;
   * PIX/boleto geram um evento `CHARGE_DUE` para o comprador pagar. Seguro para rodar
   * concorrentemente: só quem reivindica a cobrança chama o executor.
   */
  async runDue(
    now: Date,
    executor?: CycleChargeExecutor,
  ): Promise<CycleRunResult> {
    const result: CycleRunResult = {
      issued: 0,
      autoPaid: 0,
      autoFailed: 0,
      awaitingBuyer: 0,
      unknown: 0,
      expired: 0,
      buyerPaidFallback: 0,
    };
    const due = (await this.prisma.billingContract.findMany({
      where: {
        offerId: { not: null },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        nextChargeAt: { lte: now },
      },
      include: { offer: true },
      take: 200,
    })) as ContractWithOffer[];

    for (const contract of due) {
      const { offer } = contract;
      // Modo efetivo por contrato: AUTO_CHARGE só com cartão utilizável; senão o comprador paga.
      // (Antes, AUTO_CHARGE sem executor era ignorado para sempre; agora vira pago pelo comprador.)
      const mode = await effectiveRenewalMode(
        this.prisma,
        contract,
        offer,
        executor,
        now,
      );
      const buyerPaid = mode === 'MANUAL_PAY';
      if (buyerPaid && offer.renewalMode === 'AUTO_CHARGE')
        result.buyerPaidFallback++;
      const cycleKey = contract.currentPeriodEnd.toISOString();
      let claim: Charge | null;
      try {
        claim = await this.claimCycleCharge(contract, cycleKey, now, mode);
      } catch {
        // Pricing failed (e.g. invalid policy lane): leave the contract due for the next run
        // instead of aborting the other contracts.
        continue;
      }
      if (!claim) {
        // Cobrança já aberta: pago pelo comprador garante o aviso (idempotente) e expira
        // se a carência acabou.
        if (buyerPaid) await this.emitChargeDue(contract, cycleKey);
        if (await this.expireIfOverdue(contract, cycleKey, now, mode)) {
          result.expired++;
        }
        continue;
      }
      result.issued++;
      if (!buyerPaid && executor) {
        const { outcome } = await executor.charge({ charge: claim, contract });
        if (outcome === 'UNKNOWN') {
          // Ambíguo: a cobrança segue PENDING e o contrato não muda até a conciliação.
          result.unknown++;
          continue;
        }
        try {
          await this.settle(claim.id, outcome, now);
        } catch {
          // Ledger booking failed (e.g. missing financial policy): the claim rolled back, the
          // charge stays PENDING and the reconciler retries; never abort the whole run.
          result.unknown++;
          continue;
        }
        if (outcome === 'PAID') result.autoPaid++;
        else result.autoFailed++;
      } else {
        await this.emitCharge(contract.id, claim);
        result.awaitingBuyer++;
      }
    }
    return result;
  }

  /** Cria a cobrança do ciclo ou reabre uma que falhou. Retorna null se outro processo já a reivindicou. */
  private async claimCycleCharge(
    contract: ContractWithOffer,
    cycleKey: string,
    now: Date,
    mode: EffectiveRenewalMode,
  ): Promise<Charge | null> {
    const cycleMethod =
      mode === 'MANUAL_PAY' && contract.offer.renewalMode === 'AUTO_CHARGE'
        ? buyerPaidCycleMethod(contract.offer)
        : defaultCycleMethod(contract.offer);
    const existing = await this.prisma.charge.findUnique({
      where: { contractId_cycleKey: { contractId: contract.id, cycleKey } },
    });
    if (!existing) {
      // The buyer total of this cycle, priced now with the current policy and frozen on the
      // Charge: executor, retries and the ledger all read this amount, never the offer base.
      const quote = await priceOfferCycle(
        this.prisma,
        contract.offer,
        cycleMethod,
        1,
      );
      try {
        return await this.prisma.charge.create({
          data: {
            offerId: contract.offerId,
            contractId: contract.id,
            ownerUserId: contract.userId,
            amountCents: Math.round(quote.totalAmount * 100),
            method: quote.method,
            snapshot: {
              ...(frozenQuoteSnapshot(quote, now) as Record<string, unknown>),
              ...(mode === 'MANUAL_PAY' ? { buyerPaid: true } : {}),
            } as Prisma.InputJsonValue,
            currency: contract.offer.currency,
            dueAt: now,
            periodStart: contract.currentPeriodEnd,
            periodEnd: contract.currentPeriodEnd,
            cycleKey,
            attempts: 1,
            customerName: contract.customerName,
            customerEmail: contract.customerEmail,
            customerDocument: contract.customerDocument,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return null;
        }
        throw error;
      }
    }
    if (existing.status !== 'FAILED') return null;
    const reopened = await this.prisma.charge.updateMany({
      where: { id: existing.id, status: 'FAILED', attempts: existing.attempts },
      data: { status: 'PENDING', attempts: { increment: 1 } },
    });
    if (reopened.count === 0) return null;
    if (!frozenQuoteFrom(existing)) {
      // Legacy charge without a frozen quote: freeze one now (rows with a snapshot keep it).
      const quote = await priceOfferCycle(
        this.prisma,
        contract.offer,
        existing.method ?? cycleMethod,
        1,
      );
      await this.prisma.charge.update({
        where: { id: existing.id },
        data: {
          amountCents: Math.round(quote.totalAmount * 100),
          method: quote.method,
          snapshot: frozenQuoteSnapshot(quote, now),
        },
      });
    }
    return this.prisma.charge.findUniqueOrThrow({ where: { id: existing.id } });
  }

  /** Emite CHARGE_DUE uma vez por (cobrança, tentativa): a chave do evento garante idempotência. */
  private async emitCharge(
    contractId: string,
    charge: Pick<Charge, 'id' | 'attempts' | 'amountCents'>,
  ): Promise<void> {
    const eventKey = `charge-due:${charge.id}:${charge.attempts}`;
    await this.prisma.billingContractEvent.upsert({
      where: { eventKey },
      update: {},
      create: {
        contractId,
        eventKey,
        type: 'CHARGE_DUE',
        payload: { chargeId: charge.id, amountCents: charge.amountCents },
      },
    });
  }

  /** Cobrança PENDING do ciclo que ficou sem aviso (ex.: cartão revogado depois da cobrança aberta). */
  private async emitChargeDue(
    contract: ContractWithOffer,
    cycleKey: string,
  ): Promise<void> {
    const charge = await this.prisma.charge.findUnique({
      where: { contractId_cycleKey: { contractId: contract.id, cycleKey } },
    });
    if (charge?.status !== 'PENDING') return;
    // One reminder per charge: attempts also grow when the buyer asks for a new PIX (renewal
    // flow), which must not send another CHARGE_DUE.
    const sent = await this.prisma.billingContractEvent.findFirst({
      where: {
        contractId: contract.id,
        type: 'CHARGE_DUE',
        eventKey: { startsWith: `charge-due:${charge.id}:` },
      },
      select: { id: true },
    });
    if (!sent) await this.emitCharge(contract.id, charge);
  }

  private async expireIfOverdue(
    contract: ContractWithOffer,
    cycleKey: string,
    now: Date,
    mode: EffectiveRenewalMode,
  ): Promise<boolean> {
    if (mode !== 'MANUAL_PAY') return false;
    const charge = await this.prisma.charge.findUnique({
      where: { contractId_cycleKey: { contractId: contract.id, cycleKey } },
    });
    if (!charge || charge.status !== 'PENDING' || !charge.dueAt) return false;
    const graceMs = (contract.offer.graceDays ?? 7) * 24 * 60 * 60 * 1000;
    if (now.getTime() < charge.dueAt.getTime() + graceMs) return false;
    const expired = await this.prisma.charge.updateMany({
      where: { id: charge.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    if (expired.count === 0) return false;
    await this.prisma.billingContract.update({
      where: { id: contract.id },
      data: {
        status: 'SUSPENDED',
        suspendedAt: now,
        nextChargeAt: null,
        accessEndsAt: now,
        version: { increment: 1 },
      },
    });
    return true;
  }
}
