/**
 * Script: backfill-ebook-transactions.ts
 *
 * Importa transações históricas de ebook pagas do back-ebook para o banco simpay (api-machine).
 * Executa apenas uma vez após o deploy da integração webhook ebook.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-ebook-transactions.ts
 *
 * Variáveis de ambiente necessárias:
 *   DATABASE_URL          — banco simpay (api-machine)
 *   BACK_EBOOK_DB_URL     — banco back-ebook (postgres)
 *   EBOOK_ID              — (opcional) UUID genérico para autores sem conta simpay
 */

import { PrismaClient as SimpayPrisma } from '@prisma/client';
import { Client as PgClient } from 'pg';

const simpay = new SimpayPrisma();

const EBOOK_USER_ID =
  process.env.EBOOK_ID || 'd4fbf80f-6f13-4bc6-8e15-ebook00000001';
const TENANT_EBOOK_TAG = '[TENANT:EBOOK]';

async function main() {
  const backEbookDbUrl = process.env.BACK_EBOOK_DB_URL;
  if (!backEbookDbUrl) {
    throw new Error('BACK_EBOOK_DB_URL não configurado');
  }

  const pg = new PgClient({ connectionString: backEbookDbUrl });
  await pg.connect();

  console.log('Buscando pedidos pagos no back-ebook...');

  const { rows: orders } = await pg.query<{
    id: number;
    order_number: string;
    total_amount: string;
    payment_method: string;
    notes: string | null;
    created_at: Date;
    updated_at: Date;
    owner_cpf: string | null;
    buyer_email: string | null;
    dom_payment_id: string | null;
  }>(`
    SELECT
      o.id,
      o."orderNumber"     AS order_number,
      o."totalAmount"     AS total_amount,
      o."paymentMethod"   AS payment_method,
      o.notes,
      o."createdAt"       AS created_at,
      o."updatedAt"       AS updated_at,
      u.email             AS buyer_email,
      -- CPF do dono nas notes ou no livro
      COALESCE(
        (regexp_match(o.notes, '\\[CPF_DONO:(\\d{11})\\]'))[1],
        regexp_replace(COALESCE(author.cpf, ''), '[^0-9]', '', 'g')
      )                   AS owner_cpf,
      -- DOM payment id se estiver nas notes
      (regexp_match(o.notes, '\\[DOM_ID:([^\\]]+)\\]'))[1] AS dom_payment_id
    FROM "Order" o
    LEFT JOIN "User" u ON u.id = o."userId"
    LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
    LEFT JOIN "Book" b ON b.id = oi."bookId"
    LEFT JOIN "User" author ON author.id = b."createdById"
    WHERE o.status = 'paid'
      AND o."paymentStatus" = 'paid'
      AND o.store = 'ebook'
    ORDER BY o."createdAt" ASC
    LIMIT 10000
  `);

  await pg.end();

  console.log(`${orders.length} pedidos encontrados. Iniciando backfill...`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const order of orders) {
    try {
      const orderNumber = order.order_number;
      const ownerCpf = order.owner_cpf?.replace(/\D/g, '') || null;
      const amount = parseFloat(order.total_amount);

      // Verificar se já existe transação para esse orderNumber
      const domPaymentIdFallback = `EBOOK_BACKFILL_${orderNumber}`;
      const existing = await simpay.transaction.findFirst({
        where: {
          OR: [
            { domPaymentId: order.dom_payment_id || domPaymentIdFallback },
            { description: { contains: orderNumber } },
          ],
        },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Resolver userId pelo CPF do autor
      let ebookUserId = EBOOK_USER_ID;
      if (ownerCpf && ownerCpf.length === 11) {
        const cpfFormatted = ownerCpf.replace(
          /(\d{3})(\d{3})(\d{3})(\d{2})/,
          '$1.$2.$3-$4',
        );
        const author = await simpay.user.findFirst({
          where: { cpf: { in: [ownerCpf, cpfFormatted] } },
          select: { id: true },
        });
        if (author) {
          ebookUserId = author.id;
        }
      }

      // Garantir que o usuário genérico existe
      if (ebookUserId === EBOOK_USER_ID) {
        await simpay.user.upsert({
          where: { id: EBOOK_USER_ID },
          update: {},
          create: {
            id: EBOOK_USER_ID,
            name: 'EbookSim Platform',
            email: `ebook-platform@ebooksim.com`,
            cpf: '00000000000',
            password: 'SYSTEM_NO_LOGIN',
          },
        });
        await simpay.wallet.upsert({
          where: { userId: EBOOK_USER_ID },
          update: {},
          create: { userId: EBOOK_USER_ID, balance: 0, lockedBalance: 0 },
        });
      }

      // Montar description com tags
      const cpfTag = ownerCpf ? ` [CPF_DONO:${ownerCpf}]` : '';
      const description = `${orderNumber} ${TENANT_EBOOK_TAG}${cpfTag}`;
      const netAmount = amount * 0.91; // estimativa padrão sem taxas DOM

      // Wallet is moved by the BalanceLog insert trigger; never write it directly.
      await simpay.$transaction(async (tx) => {
        const row = await tx.transaction.create({
          data: {
            userId: ebookUserId,
            domPaymentId: order.dom_payment_id || domPaymentIdFallback,
            amount,
            netAmount,
            status: 'COMPLETED',
            paymentMethod: (order.payment_method || 'pix').toUpperCase() as any,
            description,
            createdAt: order.created_at,
            updatedAt: order.updated_at,
          },
        });
        await tx.balanceLog.create({
          data: {
            userId: ebookUserId,
            action: 'EBOOK_BACKFILL_CREDIT',
            source: 'EBOOK_BACKFILL',
            transactionId: row.id,
            balanceDelta: netAmount,
            lockedDelta: 0,
            description,
          },
        });
      });

      created++;
      if (created % 50 === 0) {
        console.log(`  ${created} criadas, ${skipped} ignoradas...`);
      }
    } catch (err) {
      errors++;
      console.error(`Erro no pedido ${order.order_number}:`, err);
    }
  }

  console.log(`\nBackfill concluído:`);
  console.log(`  Criadas:  ${created}`);
  console.log(`  Ignoradas (já existiam): ${skipped}`);
  console.log(`  Erros:    ${errors}`);
}

main()
  .catch(console.error)
  .finally(() => simpay.$disconnect());
