import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BillingContract, Charge, Offer } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { recordCyclePayment, type CyclePaymentDetails } from './cycle-ledger';
import { onCycleFailed, onCyclePaid, type CycleSchedule } from './cycle-policy';

/**
 * PAID/FAILED são resultados definitivos do adquirente. UNKNOWN (timeout, 5xx,
 * status pendente) deixa a cobrança PENDING e o contrato intacto: nunca paga nem falha por palpite.
 */
export type CycleChargeOutcome = 'PAID' | 'FAILED' | 'UNKNOWN';

/** Cobra um ciclo no cartão guardado. Implementada pelo cofre de cartões + adquirente. */
export interface CycleChargeExecutor {
  /** Quando existe e retorna false, o contrato AUTO_CHARGE é ignorado (adquirente sem cobrança de cartão guardado). */
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
  skippedNoExecutor: number;
};

export type RunDueOptions = {
  /** Sem executor, contratos AUTO_CHARGE são ignorados (sem cobrança nem mudança de estado). */
  skipAutoChargeWithoutExecutor?: boolean;
};

type ContractWithOffer = BillingContract & { offer: Offer };

function scheduleOf(offer: Offer, contract: BillingContract): CycleSchedule {
  return {
    intervalType: offer.intervalType ?? contract.intervalType,
    intervalCount: offer.intervalCount ?? contract.intervalCount,
    repetitions: offer.repetitions,
    retryDays: offer.retryDays,
    graceDays: offer.graceDays,
  };
}

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
        if (outcome === 'PAID' && charge.offerId) {
          const chargedOffer = await tx.offer.findUniqueOrThrow({
            where: { id: charge.offerId },
          });
          await recordCyclePayment(tx, charge, chargedOffer, details);
        }
        if (!charge.contractId) return { applied: true };
        const contract = await tx.billingContract.findUniqueOrThrow({
          where: { id: charge.contractId },
          include: { offer: true },
        });
        if (!contract.offer) return { applied: true };
        const schedule = scheduleOf(contract.offer, contract);
        const state = {
          currentPeriodEnd: contract.currentPeriodEnd,
          pastDueAt: contract.pastDueAt,
          retryCount: contract.retryCount,
        };
        let next;
        if (outcome === 'PAID') {
          const paidCycles = await tx.charge.count({
            where: { contractId: contract.id, status: 'PAID' },
          });
          next = onCyclePaid(state, schedule, paidCycles, now);
        } else {
          next = onCycleFailed(state, schedule, now);
        }
        await tx.billingContract.update({
          where: { id: contract.id },
          data: {
            status: next.status,
            currentPeriodStart: next.currentPeriodStart,
            currentPeriodEnd: next.currentPeriodEnd,
            nextChargeAt: next.nextChargeAt,
            pastDueAt: next.pastDueAt,
            suspendedAt: next.suspendedAt,
            graceEndsAt: next.graceEndsAt,
            retryCount: next.retryCount,
            accessEndsAt: next.status === 'SUSPENDED' ? now : null,
            version: { increment: 1 },
          },
        });
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
    options: RunDueOptions = {},
  ): Promise<CycleRunResult> {
    const result: CycleRunResult = {
      issued: 0,
      autoPaid: 0,
      autoFailed: 0,
      awaitingBuyer: 0,
      unknown: 0,
      expired: 0,
      skippedNoExecutor: 0,
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
      if (
        offer.renewalMode === 'AUTO_CHARGE' &&
        options.skipAutoChargeWithoutExecutor &&
        (!executor || executor.canCharge?.(contract) === false)
      ) {
        result.skippedNoExecutor++;
        continue;
      }
      const cycleKey = contract.currentPeriodEnd.toISOString();
      const claim = await this.claimCycleCharge(contract, cycleKey, now);
      if (!claim) {
        // Cobrança já aberta: no modo manual, expira se a carência acabou.
        if (await this.expireIfOverdue(contract, cycleKey, now)) {
          result.expired++;
        }
        continue;
      }
      result.issued++;
      if (offer.renewalMode === 'AUTO_CHARGE' && executor) {
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
        await this.prisma.billingContractEvent.upsert({
          where: { eventKey: `charge-due:${claim.id}:${claim.attempts}` },
          update: {},
          create: {
            contractId: contract.id,
            eventKey: `charge-due:${claim.id}:${claim.attempts}`,
            type: 'CHARGE_DUE',
            payload: { chargeId: claim.id, amountCents: claim.amountCents },
          },
        });
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
  ): Promise<Charge | null> {
    const existing = await this.prisma.charge.findUnique({
      where: { contractId_cycleKey: { contractId: contract.id, cycleKey } },
    });
    if (!existing) {
      try {
        return await this.prisma.charge.create({
          data: {
            offerId: contract.offerId,
            contractId: contract.id,
            ownerUserId: contract.userId,
            amountCents: contract.offer.amountCents,
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
    return this.prisma.charge.findUniqueOrThrow({ where: { id: existing.id } });
  }

  private async expireIfOverdue(
    contract: ContractWithOffer,
    cycleKey: string,
    now: Date,
  ): Promise<boolean> {
    if (contract.offer.renewalMode !== 'MANUAL_PAY') return false;
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
