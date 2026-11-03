import { ConflictException, UnauthorizedException } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { platformGatewayToken } from '../../application/helpers/explicit-platform.helper';
import { captureCoproduction } from '../coproduction/coproduction.service';
import {
  ebookHash,
  validateEbookManifest,
  type EbookManifest,
} from './ebook-manifest';
import { buildEbookFunding } from './ebook-settlement';

type Enrollment = {
  id: string;
  manifestHash: string;
  manifest: EbookManifest;
  identities: Record<string, string>;
  capabilityHash: string;
  state: string;
  transactionId: string | null;
};
const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export async function enrollEbook(prisma: PrismaService, value: unknown) {
  const manifest = validateEbookManifest(value);
  const manifestHash = ebookHash(manifest);
  const token = randomBytes(32).toString('base64url');
  const id = await prisma.$transaction(async (p) => {
    await p.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ebook-enrollment:${manifest.orderNumber}`}))`;
    const existing = await p.$queryRaw<
      Enrollment[]
    >`SELECT * FROM "EbookSettlement" WHERE "manifestId" = ${manifest.manifestId} OR "orderNumber" = ${manifest.orderNumber} FOR UPDATE`;
    if (existing.length) {
      if (existing[0].manifestHash !== manifestHash)
        throw new ConflictException('EBOOK_MANIFEST_CONFLICT');
      if (existing[0].state !== 'ENROLLED')
        throw new ConflictException('EBOOK_PAYMENT_ALREADY_STARTED');
      await p.$executeRaw`UPDATE "EbookSettlement" SET "capabilityHash" = ${hashToken(token)} WHERE id = ${existing[0].id}`;
      return existing[0].id;
    }
    const identities: Record<string, string> = {};
    const claims = manifest.items.flatMap((item) => [
      item.owner,
      ...(item.affiliate ? [item.affiliate] : []),
    ]);
    for (const claim of claims.sort((a, b) =>
      a.externalUserId.localeCompare(b.externalUserId),
    )) {
      await p.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ebook-identity:${claim.externalUserId}`}))`;
      const bindings = await p.$queryRaw<
        { document: string; userId: string }[]
      >`SELECT document, "userId" FROM "EbookBeneficiaryIdentity" WHERE "externalUserId" = ${claim.externalUserId}`;
      if (bindings[0] && bindings[0].document !== claim.document)
        throw new ConflictException('EBOOK_IDENTITY_REBIND_FORBIDDEN');
      const users = await p.user.findMany({
        where: {
          OR: [{ cpf: claim.document }, { cnpj: claim.document }],
          isActive: true,
          isPurged: false,
        },
        select: { id: true },
      });
      if (
        users.length !== 1 ||
        (bindings[0] && bindings[0].userId !== users[0].id)
      )
        throw new ConflictException('EBOOK_CANONICAL_IDENTITY_REQUIRED');
      if (!bindings.length)
        await p.$executeRaw`INSERT INTO "EbookBeneficiaryIdentity" ("externalUserId",document,"userId") VALUES (${claim.externalUserId},${claim.document},${users[0].id})`;
      identities[claim.externalUserId] = users[0].id;
    }
    const settlementId = randomUUID();
    await p.$executeRaw`INSERT INTO "EbookSettlement" (id,"manifestId","orderNumber","manifestHash",manifest,identities,"capabilityHash") VALUES (${settlementId},${manifest.manifestId},${manifest.orderNumber},${manifestHash},${JSON.stringify(manifest)}::jsonb,${JSON.stringify(identities)}::jsonb,${hashToken(token)})`;
    return settlementId;
  });
  return { settlementId: id, settlementToken: token, manifestHash };
}
export async function claimEbookPayment(
  prisma: PrismaService,
  input: {
    settlementId?: string;
    settlementToken?: string;
    orderNumber?: string;
    store?: string;
    price: number;
  },
  transactionId: string,
  quote: {
    totalAmount: number;
    netAmount: number;
    financialSnapshot: unknown;
  } | null,
) {
  if ((input.store ?? 'ebook').toUpperCase() !== 'EBOOK') {
    if (input.settlementId)
      throw new UnauthorizedException('EBOOK_PLATFORM_MISMATCH');
    return false;
  }
  const outcome = await prisma.$transaction(async (p) => {
    const rows = input.settlementId
      ? await p.$queryRaw<
          Enrollment[]
        >`SELECT * FROM "EbookSettlement" WHERE id = ${input.settlementId} FOR UPDATE`
      : await p.$queryRaw<
          Enrollment[]
        >`SELECT * FROM "EbookSettlement" WHERE "orderNumber" = ${input.orderNumber ?? ''} FOR UPDATE`;
    const row = rows[0];
    if (!row) {
      if (input.settlementId)
        throw new UnauthorizedException('EBOOK_CAPABILITY_INVALID');
      return false;
    }
    const candidate = hashToken(input.settlementToken ?? '');
    if (
      !input.settlementId ||
      !timingSafeEqual(Buffer.from(candidate), Buffer.from(row.capabilityHash))
    )
      throw new UnauthorizedException('EBOOK_CAPABILITY_REQUIRED');
    if (
      (input.store ?? 'ebook').toUpperCase() !== 'EBOOK' ||
      input.orderNumber !== row.manifest.orderNumber
    )
      throw new ConflictException('EBOOK_ORDER_BINDING_MISMATCH');
    if (row.state !== 'ENROLLED')
      throw new ConflictException('EBOOK_PAYMENT_IN_PROGRESS_OR_UNCERTAIN');
    const block = async (reasonCode: string) => {
      const revision = 1;
      const receiptId = `${row.id}:${revision}`;
      const payload = {
        version: 1,
        receiptId,
        settlementId: row.id,
        manifestId: row.manifest.manifestId,
        manifestHash: row.manifestHash,
        orderId: row.manifest.orderId,
        orderNumber: row.manifest.orderNumber,
        transactionId,
        revision,
        status: 'BLOCKED',
        reasonCode,
        grossCents: row.manifest.grossCents,
        allocations: [],
      };
      await p.$executeRaw`UPDATE "EbookSettlement" SET state = 'BLOCKED', "reasonCode" = ${reasonCode}, revision = 1, "transactionId" = ${transactionId} WHERE id = ${row.id}`;
      await p.transaction.update({
        where: { id: transactionId },
        data: { settlementBasis: 'EBOOK_V1' },
      });
      await p.$executeRaw`INSERT INTO "EbookSettlementReceipt" (id,"settlementId",payload) VALUES (${receiptId},${row.id},${JSON.stringify(payload)}::jsonb)`;
      return { blocked: reasonCode };
    };
    if (
      !quote ||
      Math.round(input.price * 100) !== row.manifest.grossCents ||
      Math.round(quote.totalAmount * 100) !== row.manifest.grossCents
    )
      return block('EBOOK_FUNDED_GROSS_MISMATCH');
    const platform = await p.platform.findUniqueOrThrow({
      where: { tag: 'EBOOK' },
    });
    const allParticipants = await captureCoproduction(
      p,
      'plataformas',
      platform.id,
      platform.ownerUserId,
      'EBOOK',
    );
    const feeCents =
      row.manifest.grossCents - Math.round(quote.netAmount * 100);
    let funding;
    try {
      funding = buildEbookFunding(
        row.manifest,
        feeCents,
        row.identities,
        allParticipants?.participants ?? [],
        quote.financialSnapshot,
      );
    } catch (error) {
      if (error instanceof ConflictException)
        return block('EBOOK_ALLOCATION_INVALID_OR_INSUFFICIENT');
      throw error;
    }
    await p.$executeRaw`UPDATE "EbookSettlement" SET state = 'CREATING', "providerCredentialHash" = ${hashToken(platformGatewayToken('EBOOK') ?? '')}, funding = ${JSON.stringify(funding)}::jsonb, "transactionId" = ${transactionId}, "updatedAt" = now() WHERE id = ${row.id}`;
    await p.transaction.update({
      where: { id: transactionId },
      data: {
        settlementBasis: 'EBOOK_V1',
        financialSnapshot: funding as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  });
  if (typeof outcome === 'object') throw new ConflictException(outcome.blocked);
  return outcome;
}
export async function bindEbookPayment(
  prisma: PrismaService,
  transactionId: string,
  paymentId: string,
) {
  if (!paymentId)
    throw new ConflictException('EBOOK_PROVIDER_BINDING_REQUIRED');
  await prisma.$executeRaw`UPDATE "EbookSettlement" SET "providerPaymentId" = ${paymentId}, state = 'PENDING', "updatedAt" = now() WHERE "transactionId" = ${transactionId} AND state = 'CREATING' AND "providerPaymentId" IS NULL`;
}
