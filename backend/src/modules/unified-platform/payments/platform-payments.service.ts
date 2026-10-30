import { transactionPlatformTagData } from '../../platform-core/transaction-platform';
import {
  captureCoproduction,
  withCoproduction,
} from '../../coproduction/coproduction.service';
import { quoteDeliveryCharge } from '../../integrations/delivery-payment-allocation';
import { loadDeliverySimFee } from '../../integrations/delivery-sim-fee';
import { deliveryProfile } from '../../platform-core/delivery-profile';
import type { PlatformContext } from '../../platform-core/platform-context.service';
import { loadFinancialPolicy } from '../../financial-policy/financial-policy.service';
import { quoteFinancialCharge } from '../../financial-policy/financial-charge';
import {
  estimatedCost,
  listAcquirerFees,
  orderByCost,
} from '../../financial-policy/acquirer-fees';
import { platformMerchant } from '../../platform-core/platform-merchant-lookup';
import { PlatformPaymentLookup } from './platform-payment-lookup';
import { PlatformPaymentExecution } from './platform-payment-execution';
import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PaymentGatewayResolver } from '../../../infrastructure/http/payment-gateway.resolver';
import { Acquirer } from '../../../core/services/acquirer.enum';
import { decryptPlatformSecret } from '../../platform-integrations/platform-secrets';
import { CreatePlatformPaymentDto } from './platform-payment.dto';
import { resolvePaymentAdapter } from './platform-payment.adapter';
import { resolveCardAcquirer } from './platform-card-acquirer.adapter';

export type PaymentPlatformContext = {
  id: string;
  tag: string;
  ownerUserId: string;
  acquirer: 'DOM' | 'FRENDZ';
  delivery?: PlatformContext['delivery'];
};

@Injectable()
export class PlatformPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewayResolver,
  ) {}

  async read(context: PaymentPlatformContext, reference: string) {
    const payment = await new PlatformPaymentLookup(this.prisma).find(
      context,
      reference,
    );
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    return this.result(payment);
  }

  async create(
    context: PaymentPlatformContext,
    input: CreatePlatformPaymentDto,
  ) {
    return this.execute(context, input);
  }

  async createForMerchant(
    context: PaymentPlatformContext,
    externalMerchantId: string,
    input: CreatePlatformPaymentDto,
  ) {
    const merchant = await platformMerchant(
      this.prisma,
      context,
      externalMerchantId,
    );
    return this.execute(context, input, merchant);
  }

  async readByKey(
    context: PaymentPlatformContext,
    externalMerchantId: string,
    key: string,
  ) {
    const merchant = await platformMerchant(
      this.prisma,
      context,
      externalMerchantId,
    );
    const id = createHash('sha256')
      .update(`${context.id}\0${merchant.id}\0${key}`)
      .digest('hex');
    return this.read(context, id);
  }

  private async execute(
    context: PaymentPlatformContext,
    input: CreatePlatformPaymentDto,
    merchant?: { id: string; userId: string },
  ) {
    // Re-resolve owner and activation immediately before financial writes.
    const platform = await this.prisma.platform.findUnique({
      where: { id: context.id },
      include: { owner: true, integrations: true },
    });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (
      !platform.isActive ||
      !platform.owner.isActive ||
      platform.owner.isPurged ||
      platform.ownerUserId !== context.ownerUserId
    )
      throw new ForbiddenException('Contexto da plataforma mudou');
    if (!['PIX', 'CREDIT_CARD'].includes(input.paymentMethod))
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: 'payments.' + input.paymentMethod,
      });
    if (input.linkId) {
      const link = await this.prisma.paymentLink.findFirst({
        where: {
          id: input.linkId,
          userId: platform.ownerUserId,
          plataformas: { has: platform.tag },
          isActive: true,
        },
      });
      if (!link || !link.amount.mul(100).equals(input.amountCents))
        throw new UnprocessableEntityException({
          code: 'INVALID_LINK_PAYMENT',
        });
    }
    if (
      input.paymentMethod === 'CREDIT_CARD' &&
      (!input.card ||
        !input.card.token ||
        !input.card.holderName ||
        !/^\d{6,8}$/.test(input.card.bin) ||
        !input.card.brand ||
        !Number.isInteger(input.card.installments) ||
        input.card.installments < 1 ||
        input.card.installments > 12)
    )
      throw new UnprocessableEntityException({
        code: 'INVALID_PAYMENT_CONTRACT',
      });
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.amountCents > 999999999999 ||
      !input.idempotencyKey ||
      input.idempotencyKey.length > 128 ||
      !input.customer
    )
      throw new UnprocessableEntityException({
        code: 'INVALID_PAYMENT_CONTRACT',
      });
    if (
      input.allocation &&
      (!context.delivery?.allocate ||
        !merchant ||
        context.delivery.merchantId !== merchant.id)
    )
      throw new ForbiddenException('Divisão financeira não autorizada');
    if (context.delivery && !input.allocation)
      throw new UnprocessableEntityException({
        code: 'DELIVERY_ALLOCATION_REQUIRED',
      });
    const acquiring = context.delivery
      ? await deliveryProfile(this.prisma, context)
      : null;
    const adapter = resolvePaymentAdapter(platform.tag);
    const financialUserId = merchant?.userId ?? platform.ownerUserId;
    const id = createHash('sha256')
      .update(`${platform.id}\0${merchant?.id ?? ''}\0${input.idempotencyKey}`)
      .digest('hex');
    const marker = `[TENANT:${platform.tag}]`;
    // Persist only a digest of card contract; never persist reusable tokens.
    const cardDigest =
      input.paymentMethod === 'CREDIT_CARD'
        ? createHash('sha256')
            .update(
              JSON.stringify([
                input.card!.token,
                input.card!.holderName,
                input.card!.bin,
                input.card!.brand,
                input.card!.installments,
              ]),
            )
            .digest('hex')
        : undefined;
    const description = `${adapter.description(input.description)} ${marker}`;
    const amount = new Prisma.Decimal(input.amountCents).div(100);
    const existing = await this.prisma.transaction.findUnique({
      where: { id },
    });
    if (existing) {
      // Old transactions stored the digest in the description. Accept their replay
      // without rewriting financial history or weakening card contract validation.
      const legacyDigest = existing.description?.match(
        / \[REQUEST:([a-f0-9]{64})\]$/,
      )?.[1];
      const savedDigest =
        (existing.tracking as { cardRequestDigest?: string } | null)
          ?.cardRequestDigest ?? legacyDigest;
      const savedDescription = legacyDigest
        ? existing.description!.replace(/ \[REQUEST:[a-f0-9]{64}\]$/, '')
        : existing.description;
      if (
        existing.userId !== financialUserId ||
        (existing.paymentLinkId ?? undefined) !== input.linkId ||
        !(existing.financialSnapshot
          ? new Prisma.Decimal(
              (
                existing.financialSnapshot as {
                  originalCents?: number;
                  totalAmountCents?: number;
                }
              ).originalCents ??
                (existing.financialSnapshot as { totalAmountCents: number })
                  .totalAmountCents,
            )
              .div(100)
              .equals(amount)
          : existing.amount.equals(amount)) ||
        savedDescription !== description ||
        savedDigest !== cardDigest ||
        existing.customerEmail !== input.customer.email ||
        existing.customerDocument !== input.customer.document ||
        existing.customerName !== input.customer.name ||
        existing.customerPhone !== (input.customer.phone ?? '') ||
        existing.paymentMethod !== input.paymentMethod
      )
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      if (!existing.externalPaymentId)
        throw new ConflictException({
          code: 'PAYMENT_PROCESSING',
          transactionId: id,
        });
      if (
        input.allocation &&
        (input.allocation.itemsAmountCents !==
          (existing.financialSnapshot as any)?.itemsAmountCents ||
          input.allocation.deliveryAmountCents !==
            (existing.financialSnapshot as any)?.deliveryAmountCents)
      )
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      if (
        input.allocation &&
        JSON.stringify([
          input.allocation.merchantAmountCents,
          input.allocation.platformFeeCents,
        ]) !==
          JSON.stringify([
            (existing.financialSnapshot as any)?.merchantAmountCents,
            (existing.financialSnapshot as any)?.platformFeeCents,
          ])
      )
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return this.result(existing);
    }
    await this.prisma.wallet.upsert({
      where: { userId: financialUserId },
      update: {},
      create: { userId: financialUserId, balance: 0, lockedBalance: 0 },
    });
    const overrides = await this.prisma.platformTaxaOverride.findMany({
      where: {
        tag: {
          in: ['GLOBAL', platform.tag, platform.tag.replaceAll('-', '_')],
        },
      },
    });
    const rates: Record<string, number> = {};
    for (const row of overrides.filter((row) => row.tag === 'GLOBAL'))
      rates[row.key] = row.value;
    for (const row of overrides.filter((row) => row.tag !== 'GLOBAL'))
      rates[row.key] = row.value;
    // Delivery credentials are tied to their configured acquirer; never route them
    // through another integration. For ordinary checkout, consider only gateways
    // that can actually process this method and have a usable credential.
    const policy = input.allocation
      ? undefined
      : await loadFinancialPolicy(this.prisma, platform.tag);
    const installments =
      input.paymentMethod === 'CREDIT_CARD' ? input.card!.installments : 1;
    const supported =
      input.paymentMethod === 'CREDIT_CARD' ? ['DOM'] : ['DOM', 'FRENDZ'];
    const candidates = supported.filter((code) =>
      platform.integrations.some(
        (row) => row.key === `${code}_TOKEN` && !!row.encryptedValue,
      ),
    );
    const catalogue =
      !acquiring && !existing
        ? await this.prisma.acquirerCatalogue.findMany({
            select: { code: true, active: true },
          })
        : [];
    const fees =
      !acquiring && !existing
        ? await listAcquirerFees(
            this.prisma,
            input.paymentMethod as 'PIX' | 'CREDIT_CARD',
            'ONLINE',
            installments,
          )
        : [];
    const feeContext = {
      feesByLane: { [`${input.paymentMethod}/ONLINE/${installments}`]: fees },
    };
    // The quote engine prices every candidate from the same active schedule,
    // including buyer-total bases and the shared price floor.
    const pricingFee = fees.find(
      (fee) =>
        candidates.includes(fee.acquirer) &&
        !!policy?.document.lanes[
          `${fee.acquirer}/${input.paymentMethod}/ONLINE/${installments}`
        ],
    );
    const priced =
      !acquiring && !existing && policy && pricingFee
        ? quoteFinancialCharge(
            {
              policy,
              acquirer: pricingFee.acquirer,
              tag: platform.tag,
              ...feeContext,
            },
            amount.toNumber(),
            input.paymentMethod as 'PIX' | 'CREDIT_CARD',
            installments,
          )
        : null;
    const buyerTotalCents = priced
      ? Math.round(priced.totalAmount * 100)
      : input.amountCents;
    const configured = orderByCost(
      fees.filter(
        (fee) =>
          candidates.includes(fee.acquirer) &&
          (!policy ||
            !Object.keys(policy.document.lanes).length ||
            !!policy.document.lanes[
              `${fee.acquirer}/${input.paymentMethod}/ONLINE/${installments}`
            ]),
      ),
      input.amountCents,
      buyerTotalCents,
    );
    // A candidate with an unknown cost must never undercut a known fee.
    // Once this lane has active schedules, only an active, scheduled and
    // credentialed provider may process it. Missing schedules retain historical
    // platform routing while financial policy is being configured.
    if (!acquiring && !existing && fees.length && !configured.length)
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: `payments.${input.paymentMethod}`,
      });
    const selectedAcquirer =
      acquiring || existing
        ? platform.acquirer
        : (configured[0]?.acquirer ?? platform.acquirer);
    if (
      !supported.includes(selectedAcquirer) ||
      (catalogue.length > 0 &&
        !catalogue.some(
          (provider) => provider.code === selectedAcquirer && provider.active,
        ))
    )
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
        capability: `payments.${input.paymentMethod}`,
        acquirer: selectedAcquirer,
      });
    const selectedFee = fees.find((fee) => fee.acquirer === selectedAcquirer);
    const scheduledFees = selectedFee ? fees : [];
    const cardAcquirer =
      input.paymentMethod === 'CREDIT_CARD'
        ? resolveCardAcquirer(selectedAcquirer)
        : undefined;
    const integration = platform.integrations.find(
      (row) => row.key === `${selectedAcquirer}_TOKEN`,
    );
    if (!acquiring && !integration?.encryptedValue)
      throw new UnprocessableEntityException({
        code: 'PLATFORM_CONFIGURATION_MISSING',
        key: `${selectedAcquirer}_TOKEN`,
      });
    const token =
      acquiring?.token ?? decryptPlatformSecret(integration!.encryptedValue!);
    const deliveryQuote = input.allocation
      ? quoteDeliveryCharge(
          amount.toNumber(),
          input.allocation,
          await loadDeliverySimFee(
            this.prisma,
            platform.tag,
            input.allocation,
            input.paymentMethod as 'PIX' | 'CREDIT_CARD',
            installments,
          ),
        )
      : undefined;
    const financialQuote = deliveryQuote
      ? {
          ...deliveryQuote,
          // Additive surcharge plus SimIntPay's own fee is platform revenue; acquirer cost is booked separately.
          platformProfit: deliveryQuote.totalFeeAmount,
        }
      : quoteFinancialCharge(
          {
            policy: policy!,
            acquirer: selectedAcquirer,
            tag: platform.tag,
            feesByLane: {
              [`${input.paymentMethod}/ONLINE/${installments}`]: scheduledFees,
            },
          },
          amount.toNumber(),
          input.paymentMethod as 'PIX' | 'CREDIT_CARD',
          cardAcquirer ? input.card!.installments : 1,
        );
    const chargeAmount = new Prisma.Decimal(
      financialQuote?.totalAmount ?? amount,
    );
    const chargeCents = chargeAmount.mul(100).toNumber();
    // Acquirer cost is recorded for every payment, Delivery included: it is a platform cost, never charged to the merchant.
    const realizedCostCents = selectedFee
      ? estimatedCost(selectedFee, input.amountCents, chargeCents)
      : undefined;
    const costSnapshot =
      selectedFee && realizedCostCents !== undefined
        ? {
            acquirer: selectedAcquirer,
            fixedCents: selectedFee.fixedCents,
            ratePpm: selectedFee.ratePpm,
            interestPpm: selectedFee.interestPpm,
            base: selectedFee.base,
            source: selectedFee.source,
            createdAt: selectedFee.createdAt.toISOString(),
            realizedCents: realizedCostCents,
          }
        : undefined;
    const financialFields = financialQuote
      ? {
          amount: chargeAmount,
          netAmount: new Prisma.Decimal(financialQuote.netAmount),
          totalFee: new Prisma.Decimal(financialQuote.totalFeeAmount),
          domFee: new Prisma.Decimal(
            deliveryQuote && realizedCostCents !== undefined
              ? realizedCostCents / 100
              : financialQuote.domFeeAmount,
          ),
          platformFee: new Prisma.Decimal(financialQuote.platformProfit),
          financialSnapshot: financialQuote.financialSnapshot,
          settlementBasis: 'FINAL_NET' as const,
        }
      : adapter.fees(
          amount,
          rates,
          cardAcquirer ? input.card!.installments : undefined,
        );
    const coproduction = input.linkId
      ? await captureCoproduction(
          this.prisma,
          'links-pagamento',
          input.linkId,
          financialUserId,
          platform.tag,
        )
      : await captureCoproduction(
          this.prisma,
          'plataformas',
          platform.id,
          financialUserId,
        );
    if (coproduction && context.delivery) {
      if (
        input.allocation?.itemsAmountCents === undefined ||
        input.allocation.deliveryAmountCents === undefined
      )
        throw new UnprocessableEntityException({
          code: 'COPRODUCTION_BASE_REQUIRED',
          message: 'Cobrança exige detalhamento de itens e frete',
        });
      coproduction.baseCents = input.allocation.itemsAmountCents;
    }
    if (coproduction && coproduction.baseCents === undefined)
      coproduction.baseCents = financialFields.netAmount.mul(100).toNumber();
    const finalSnapshot = withCoproduction(
      financialQuote?.financialSnapshot ??
        (costSnapshot
          ? { acquirerCost: costSnapshot, originalCents: input.amountCents }
          : coproduction
            ? { originalCents: input.amountCents }
            : undefined),
      coproduction,
    );
    try {
      await new PlatformPaymentExecution(this.prisma).reserve({
        id,
        userId: financialUserId,
        tracking: {
          ...(cardDigest ? { cardRequestDigest: cardDigest } : {}),
          ...(context.delivery
            ? {
                delivery: {
                  credentialId: context.delivery.credentialId,
                  externalCompanyId: context.delivery.externalCompanyId,
                  idempotencyKey: input.idempotencyKey,
                },
              }
            : {}),
          reportAttribution: {
            platformId: platform.id,
            ownerUserId: platform.ownerUserId,
            beneficiaryUserId: financialUserId,
          },
        },
        amount,
        ...(input.linkId ? { paymentLinkId: input.linkId } : {}),
        ...financialFields,
        ...(finalSnapshot ? { financialSnapshot: finalSnapshot } : {}),
        status: 'DRAFT',
        paymentMethod: input.paymentMethod,
        acquirer: selectedAcquirer as Acquirer,
        description,
        ...transactionPlatformTagData(platform.tag),
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        customerDocument: input.customer.document,
        customerPhone: input.customer.phone ?? '',
        installments: cardAcquirer ? input.card!.installments : 1,
        ...(cardAcquirer
          ? { cardBin: input.card!.bin, cardBrand: input.card!.brand }
          : {}),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException({
          code: 'PAYMENT_PROCESSING',
          transactionId: id,
        });
      throw error;
    }
    // Frendz's current transport expects cents; DOM's expects reais.
    const { transaction: stored } = await new PlatformPaymentExecution(
      this.prisma,
    ).charge({
      transactionId: id,
      charge: async () =>
        cardAcquirer
          ? cardAcquirer.charge(token, {
              id,
              amountCents: chargeCents,
              description: `${adapter.description(input.description)} ${marker}`,
              customer: input.customer,
              card: input.card!,
            })
          : this.gateways
              .byAcquirer(selectedAcquirer as Acquirer)
              .createPixCheckout(token, {
                codExternal: id,
                amount:
                  selectedAcquirer === 'FRENDZ'
                    ? chargeCents
                    : chargeAmount.toNumber(),
                description: `${adapter.description(input.description)} ${marker}`,
                customerName: input.customer.name,
                customerEmail: input.customer.email,
                customerDocument: input.customer.document,
                customerPhone: input.customer.phone ?? '',
                documentType: input.customer.documentType,
              }),
      rejection: (payment) =>
        !!cardAcquirer &&
        [
          'not_authorized',
          'error',
          'failed',
          'refused',
          'canceled',
          'expired',
        ].includes(payment.status),
      references: (payment) => ({
        externalPaymentId: payment.id,
        ...(selectedAcquirer === 'DOM' ? { domPaymentId: payment.id } : {}),
        pixQrCode: payment.qrCode,
        pixContent: payment.pixContent,
        pixExpire: payment.pixExpire ? new Date(payment.pixExpire) : null,
      }),
    });
    return this.result(stored);
  }

  private result(transaction: {
    id: string;
    externalPaymentId: string | null;
    status: string;
    amount: Prisma.Decimal;
    netAmount?: Prisma.Decimal | null;
    financialSnapshot?: unknown;
    pixContent: string | null;
    pixQrCode: string | null;
    pixExpire: Date | null;
  }) {
    return {
      transactionId: transaction.id,
      paymentId: transaction.externalPaymentId,
      status: transaction.status,
      amountCents: transaction.amount.mul(100).toNumber(),
      netAmountCents: transaction.netAmount?.mul(100).toNumber() ?? null,
      // Frozen with the Delivery allocation; zero for additive-only and for every non-Delivery payment.
      simintpayFeeCents: Number(
        (transaction.financialSnapshot as { simFeeCents?: unknown } | null)
          ?.simFeeCents ?? 0,
      ),
      pixContent: transaction.pixContent,
      qrCode: transaction.pixQrCode,
      pixExpire: transaction.pixExpire,
    };
  }
}
