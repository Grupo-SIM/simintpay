import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';

/**
 * Phase 4 of plan 0023: maintenance/freeze flag for the legacy product writers (public checkouts of
 * payment link, subscription link, boleto and plan, the CRUD controllers and the platform routes that
 * write `PaymentLink`, `SubscriptionLink`, `Plan`, `PixCreditPlan` and `Boleto`).
 *
 * `OFFER_LEGACY_FREEZE=1` (or `true`) makes them answer 503 with a clear message while the owner
 * copies the delta to `Offer` (`scripts/offer-migration-delta.ts`). Off by default. Read on every
 * request, so it can be flipped by restarting the process with the new environment. Webhooks, reads and
 * settlement of payments already in flight are never frozen.
 */
export const OFFER_LEGACY_FREEZE_ENV = 'OFFER_LEGACY_FREEZE';
export const OFFER_LEGACY_FREEZE_CODE = 'OFFER_LEGACY_FREEZE';
export const OFFER_LEGACY_FREEZE_MESSAGE =
  'Operação temporariamente indisponível: estamos migrando links, planos e boletos para ofertas. Tente novamente em alguns minutos.';
export const OFFER_LEGACY_FREEZE_RETRY_AFTER_SECONDS = 300;

export function offerLegacyFreezeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return ['1', 'true'].includes(
    String(env[OFFER_LEGACY_FREEZE_ENV] ?? '')
      .trim()
      .toLowerCase(),
  );
}

/** Throws 503 while the freeze is on. For writers that are not controller routes. */
export function assertOfferLegacyWritable(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!offerLegacyFreezeEnabled(env)) return;
  throw new ServiceUnavailableException({
    statusCode: 503,
    code: OFFER_LEGACY_FREEZE_CODE,
    message: OFFER_LEGACY_FREEZE_MESSAGE,
    retryAfterSeconds: OFFER_LEGACY_FREEZE_RETRY_AFTER_SECONDS,
  });
}

@Injectable()
export class OfferLegacyFreezeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!offerLegacyFreezeEnabled()) return true;
    const response = context.switchToHttp().getResponse<{
      setHeader?: (name: string, value: string) => void;
    }>();
    response?.setHeader?.(
      'Retry-After',
      String(OFFER_LEGACY_FREEZE_RETRY_AFTER_SECONDS),
    );
    assertOfferLegacyWritable();
    return true;
  }
}

/** Marks a controller (or a route) that writes legacy product tables: 503 while frozen. */
export const OfferLegacyWriter = () =>
  applyDecorators(UseGuards(OfferLegacyFreezeGuard));
