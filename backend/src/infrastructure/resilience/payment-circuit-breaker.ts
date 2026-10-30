import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma/prisma.service';

export type CircuitOutcome = 'SUCCESS' | 'FAILURE' | 'IGNORE';
export type CircuitPermit = Readonly<{
  provider: string;
  operation: string;
  token: string;
  fence: bigint;
  probe: boolean;
}>;

type CircuitState = {
  status: string;
  fence: bigint;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  cooldownUntil: Date | null;
};
type CircuitCounts = { success: bigint; failure: bigint };

export class CircuitOpenException extends ServiceUnavailableException {
  constructor(provider: string, operation: string) {
    super(`Payment provider circuit is open: ${provider}/${operation}`);
  }
}

export class CircuitUnavailableException extends ServiceUnavailableException {
  constructor() {
    super('Payment circuit state is unavailable; provider dispatch is blocked');
  }
}

/** A shared circuit per provider/operation. No retry is performed by this service. */
@Injectable()
export class PaymentCircuitBreaker {
  private readonly logger = new Logger(PaymentCircuitBreaker.name);
  private readonly windowMs = 60_000;
  private readonly minSamples = 10;
  private readonly failurePercent = 50;
  private readonly cooldownMs = 30_000;
  private readonly probeLeaseMs = 60_000;

  private jitteredCooldownMs(): number {
    return this.cooldownMs + Math.floor(Math.random() * this.cooldownMs * 0.2);
  }

  constructor(private readonly prisma: PrismaService) {}

  async begin(provider: string, operation: string): Promise<CircuitPermit> {
    if (!provider || !operation)
      throw new Error('Circuit provider and operation are required');
    try {
      const permit = await this.prisma.$transaction(
        async (tx): Promise<CircuitPermit | null> => {
          await tx.$executeRaw`INSERT INTO "PaymentCircuitState" ("provider", "operation", "updatedAt") VALUES (${provider}, ${operation}, clock_timestamp()) ON CONFLICT DO NOTHING`;
          const state = await this.lock(tx, provider, operation);
          const now = await this.clock(tx);
          if (
            state.status === 'OPEN' &&
            (!state.cooldownUntil || state.cooldownUntil > now)
          ) {
            throw new CircuitOpenException(provider, operation);
          }
          if (state.status === 'HALF_OPEN') {
            if (!state.leaseExpiresAt || state.leaseExpiresAt > now)
              throw new CircuitOpenException(provider, operation);
            // The previous probe may have reached the provider. Its payment attempt
            // stays UNKNOWN until reconciled. Fence its circuit result and restart
            // the cooldown; never interpret expiry as proof of failed creation.
            await this.open(tx, provider, operation, now);
            return null;
          }

          const token = randomUUID();
          if (state.status === 'OPEN') {
            const fence = state.fence + 1n;
            await tx.$executeRaw`UPDATE "PaymentCircuitState" SET "status" = 'HALF_OPEN', "fence" = ${fence}, "leaseToken" = ${token}, "leaseExpiresAt" = ${new Date(now.getTime() + this.probeLeaseMs)}, "updatedAt" = clock_timestamp() WHERE "provider" = ${provider} AND "operation" = ${operation}`;
            this.logger.warn(
              `Circuit probe admitted for ${provider}/${operation}, fence ${fence}`,
            );
            return { provider, operation, token, fence, probe: true };
          }
          // CLOSED requests do not hold the row lock during their provider call.
          return {
            provider,
            operation,
            token,
            fence: state.fence,
            probe: false,
          };
        },
      );
      if (!permit) throw new CircuitOpenException(provider, operation);
      return permit;
    } catch (error) {
      if (error instanceof CircuitOpenException) throw error;
      this.logger.error(
        `Circuit begin failed for ${provider}/${operation}`,
        error,
      );
      throw new CircuitUnavailableException();
    }
  }

  async complete(
    permit: CircuitPermit,
    outcome: CircuitOutcome,
  ): Promise<void> {
    if (!['SUCCESS', 'FAILURE', 'IGNORE'].includes(outcome))
      throw new Error('Invalid circuit outcome');
    try {
      await this.prisma.$transaction(async (tx) => {
        const state = await this.lock(tx, permit.provider, permit.operation);
        // A late/stale probe cannot close a newer circuit generation.
        if (
          permit.probe &&
          (state.status !== 'HALF_OPEN' ||
            state.fence !== permit.fence ||
            state.leaseToken !== permit.token)
        ) {
          this.logger.warn(
            `Stale circuit probe ignored for ${permit.provider}/${permit.operation}`,
          );
          return;
        }
        const now = await this.clock(tx);
        if (
          permit.probe &&
          (!state.leaseExpiresAt || state.leaseExpiresAt <= now)
        ) {
          // An expired probe is not health evidence, even if its result arrived
          // before a second caller had a chance to fence it in begin().
          await this.open(tx, permit.provider, permit.operation, now);
          return;
        }
        // IGNORE still claims the permit token, preventing a conflicting later
        // completion from turning a validation decline into a provider failure.
        const inserted =
          await tx.$executeRaw`INSERT INTO "PaymentCircuitEvent" ("token", "provider", "operation", "outcome", "probe", "createdAt") VALUES (${permit.token}, ${permit.provider}, ${permit.operation}, ${outcome}, ${permit.probe}, ${now}) ON CONFLICT ("token") DO NOTHING`;
        if (inserted === 0) return; // first completion wins
        if (permit.probe) {
          if (outcome === 'SUCCESS') {
            await tx.$executeRaw`UPDATE "PaymentCircuitState" SET "status" = 'CLOSED', "leaseToken" = NULL, "leaseExpiresAt" = NULL, "cooldownUntil" = NULL, "openedAt" = NULL, "updatedAt" = clock_timestamp() WHERE "provider" = ${permit.provider} AND "operation" = ${permit.operation}`;
            this.logger.log(
              `Circuit closed for ${permit.provider}/${permit.operation}`,
            );
          } else {
            // IGNORE means no provider dispatch occurred; it is not proof of health.
            await this.open(tx, permit.provider, permit.operation, now);
          }
          return;
        }
        if (
          outcome !== 'FAILURE' ||
          state.status !== 'CLOSED' ||
          state.fence !== permit.fence
        )
          return;
        const [counts] = await tx.$queryRaw<
          CircuitCounts[]
        >`SELECT count(*) FILTER (WHERE "outcome" = 'SUCCESS')::bigint AS success, count(*) FILTER (WHERE "outcome" = 'FAILURE')::bigint AS failure FROM "PaymentCircuitEvent" WHERE "provider" = ${permit.provider} AND "operation" = ${permit.operation} AND "createdAt" > ${new Date(now.getTime() - this.windowMs)}`;
        const samples = counts.success + counts.failure;
        if (
          samples >= BigInt(this.minSamples) &&
          counts.failure * 100n >= samples * BigInt(this.failurePercent)
        ) {
          await this.open(tx, permit.provider, permit.operation, now);
        }
      });
    } catch (error) {
      this.logger.error(
        `Circuit completion failed for ${permit.provider}/${permit.operation}; dispatch outcome needs reconciliation`,
        error,
      );
      throw new CircuitUnavailableException();
    }
  }

  async inspect(provider: string, operation: string) {
    try {
      return await this.prisma.paymentCircuitState.findUnique({
        where: { provider_operation: { provider, operation } },
      });
    } catch (error) {
      this.logger.error(
        `Circuit inspection failed for ${provider}/${operation}`,
        error,
      );
      throw new CircuitUnavailableException();
    }
  }

  private async lock(
    tx: Prisma.TransactionClient,
    provider: string,
    operation: string,
  ): Promise<CircuitState> {
    const [state] = await tx.$queryRaw<
      CircuitState[]
    >`SELECT "status", "fence", "leaseToken", "leaseExpiresAt", "cooldownUntil" FROM "PaymentCircuitState" WHERE "provider" = ${provider} AND "operation" = ${operation} FOR UPDATE`;
    if (!state) throw new Error('Missing circuit state');
    return state;
  }

  private async clock(tx: Prisma.TransactionClient): Promise<Date> {
    const [result] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    return result.now;
  }

  private async open(
    tx: Prisma.TransactionClient,
    provider: string,
    operation: string,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw`UPDATE "PaymentCircuitState" SET "status" = 'OPEN', "fence" = "fence" + 1, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "openedAt" = ${now}, "cooldownUntil" = ${new Date(now.getTime() + this.jitteredCooldownMs())}, "updatedAt" = clock_timestamp() WHERE "provider" = ${provider} AND "operation" = ${operation}`;
    this.logger.warn(`Circuit opened for ${provider}/${operation}`);
  }
}
