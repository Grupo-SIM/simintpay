import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';

@Injectable()
export class EbookReceiptOutboxService {
  constructor(private readonly prisma: PrismaService) {}
  @Interval(15000)
  async deliver() {
    const platform = await this.prisma.platform.findUnique({
      where: { tag: 'EBOOK' },
      include: { integrations: true },
    });
    if (!platform?.isActive) return;
    const backend = platform.integrations.find(
      (row) => row.key === 'BACKEND_URL',
    )?.url;
    const credential = platform.integrations.find(
      (row) => row.key === 'INTERNAL_TOKEN',
    );
    if (!backend || !credential?.encryptedValue) return;
    const token = decryptPlatformSecret(credential.encryptedValue);
    if (!token) return;
    // Holding the row lock prevents parallel workers; acknowledgement is recorded only after durable remote acceptance.
    await this.prisma.$transaction(
      async (p) => {
        const receipts = await p.$queryRaw<
          { id: string; payload: unknown }[]
        >`SELECT id,payload FROM "EbookSettlementReceipt" WHERE "deliveredAt" IS NULL ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1`;
        const receipt = receipts[0];
        if (!receipt) return;
        await p.$executeRaw`UPDATE "EbookSettlementReceipt" SET attempts = attempts + 1 WHERE id = ${receipt.id}`;
        try {
          const response = await fetch(
            `${backend.replace(/\/+$/, '')}/internal/ebook/settlements/receipts`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-internal-token': token,
              },
              body: JSON.stringify(receipt.payload),
              signal: AbortSignal.timeout(5000),
            },
          );
          if (response.ok)
            await p.$executeRaw`UPDATE "EbookSettlementReceipt" SET "deliveredAt" = now() WHERE id = ${receipt.id}`;
        } catch {
          /* Durable retry: never rerun the ledger to redeliver a receipt. */
        }
      },
      { timeout: 10000 },
    );
  }
}
