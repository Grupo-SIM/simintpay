import { Injectable, Logger, Inject } from '@nestjs/common';
import { Prisma, TransactionStatus, PaymentMethod } from '@prisma/client';
import dayjs from 'dayjs';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

/**
 * Seriais das maquinetas que pertencem ao usuário Renovada 12.
 */
const RENOVADA_MACHINE_SERIALS = [
  'PB1S24C373609',
  'PB1S24C373623',
  'PB1S24C373616',
  'PB1S24C373596',
  '4AF61W62R',
  '4AF61V34L',
  '4AF61VY6G',
];

const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';
const TAXA_MAQUINETA = 0.09; // 9%

@Injectable()
export class SyncMaquinetasUseCase {
  private readonly logger = new Logger(SyncMaquinetasUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
  ) {}

  async execute(): Promise<{
    synced: number;
    skipped: number;
    errors: number;
    totalAmount: number;
    message: string;
  }> {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken) {
      throw new Error('DOM_TOKEN não configurado no .env');
    }

    // Verificar se o usuário e wallet existem
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: RENOVADA_ID },
    });
    if (!wallet) {
      throw new Error('Wallet da Renovada não encontrada');
    }

    // Buscar todas as transações de maquinetas da DOM Pagamentos
    const allMachineTxs = await this.fetchAllMachineTxsFromDom(domToken);
    this.logger.log(`[SyncMaquinetas] Encontradas ${allMachineTxs.length} transações de maquinetas na DOM`);

    let synced = 0;
    let skipped = 0;
    let errors = 0;
    let totalAmount = 0;

    for (const tx of allMachineTxs) {
      try {
        // Verificar se já existe no banco
        const existing = await this.prisma.transaction.findFirst({
          where: { domPaymentId: tx.id, userId: RENOVADA_ID },
        });

        if (existing) {
          skipped++;
          continue;
        }

        const amountReais = tx.amount / 100; // DOM envia em centavos
        const netbalancemachine = amountReais * (1 - TAXA_MAQUINETA); // valor - 9%

        const serial = tx.serial;
        const paymentMethod = tx.payment_method?.toLowerCase().includes('card')
          ? PaymentMethod.CREDIT_CARD
          : PaymentMethod.PIX;

        await this.prisma.$transaction(async (p) => {
          const newTx = await p.transaction.create({
            data: {
              userId: RENOVADA_ID,
              domPaymentId: tx.id,
              amount: new Prisma.Decimal(amountReais),
              netAmount: new Prisma.Decimal(netbalancemachine),
              totalFee: new Prisma.Decimal(amountReais - netbalancemachine),
              domFee: new Prisma.Decimal(0),
              platformFee: new Prisma.Decimal(amountReais - netbalancemachine),
              status: TransactionStatus.COMPLETED,
              paymentMethod,
              description: `Maquineta - Terminal: ${serial}`,
              installments: Number(tx.installments ?? 1),
              customerName: tx.customer_name ?? 'Cliente POS',
              customerEmail: tx.customer_email ?? '',
              customerDocument: tx.customer_document ?? '',
              customerPhone: tx.customer_phone ?? '',
              cardBrand: tx.card_brand ?? null,
              cardBin: tx.card_bin ?? null,
              createdAt: tx.created_at ? new Date(tx.created_at) : new Date(),
            },
          });

          await p.transactionStatusHistory.create({
            data: {
              transactionId: newTx.id,
              fromStatus: TransactionStatus.DRAFT,
              toStatus: TransactionStatus.COMPLETED,
              metadata: { reason: 'sync-maquinetas', serial },
            },
          });

          // Adicionar o valor bruto ao wallet.balance (netBalance = balance * 0.91)
          const currentWallet = await p.wallet.findUnique({ where: { userId: RENOVADA_ID } });
          if (currentWallet) {
            const newBalance = currentWallet.balance.add(new Prisma.Decimal(amountReais));
            await p.wallet.updateMany({
              where: { id: currentWallet.id, version: currentWallet.version },
              data: { balance: newBalance, version: { increment: 1 } },
            });
            await p.balanceLog.create({
              data: {
                userId: RENOVADA_ID,
                action: 'MAQUINETA_SYNC',
                transactionId: newTx.id,
                amount: new Prisma.Decimal(amountReais),
                balanceBefore: currentWallet.balance,
                balanceAfter: newBalance,
                lockedBefore: currentWallet.lockedBalance,
                lockedAfter: currentWallet.lockedBalance,
                source: 'MAQUINETA_SYNC',
                description: `Terminal: ${serial}`,
              },
            });
          }
        });

        synced++;
        totalAmount += amountReais;
        this.logger.log(`[SyncMaquinetas] Sincronizada: domId=${tx.id}, serial=${serial}, valor=R$${amountReais.toFixed(2)}`);
      } catch (err: any) {
        if (err?.code === 'P2002') {
          skipped++;
        } else {
          errors++;
          this.logger.error(`[SyncMaquinetas] Erro ao sincronizar ${tx.id}: ${err.message}`);
        }
      }
    }

    const message = `Sincronização concluída: ${synced} novas, ${skipped} já existentes, ${errors} erros. Total: R$${totalAmount.toFixed(2)}`;
    this.logger.log(`[SyncMaquinetas] ${message}`);

    return { synced, skipped, errors, totalAmount, message };
  }

  /** Busca TODAS as transações pagas de maquinetas diretamente da DOM Pagamentos */
  private async fetchAllMachineTxsFromDom(domToken: string): Promise<any[]> {
    const baseUrl = (process.env.DOM_REAL_API_URL ?? 'https://apiv3.dompagamentos.com.br/checkout/production').replace(/\/$/, '');
    const url = `${baseUrl}/transactions`;

    const beginDate = process.env.MAQUINETA_SYNC_BEGIN_DATE ?? '2024-01-01';
    const endDate = dayjs().format('YYYY-MM-DD');

    const headers = {
      Authorization: `Bearer ${domToken}`,
      'x-access-token': domToken,
      Accept: 'application/json',
    };

    const allTxs: any[] = [];
    let page = 1;
    const limit = 100;

    while (true) {
      try {
        const res = await firstValueFrom(
          this.http.get<any>(url, {
            headers,
            params: {
              page,
              limit,
              status: 'paid',
              begin_date: beginDate,
              end_date: endDate,
            },
          }),
        );

        const root = res.data;
        const items: any[] = Array.isArray(root?.data)
          ? root.data
          : Array.isArray(root?.transactions)
          ? root.transactions
          : Array.isArray(root)
          ? root
          : [];

        if (items.length === 0) break;

        // Filtrar apenas transações de maquinetas
        const machineItems = items.filter((item) => this.isMachineTx(item));
        allTxs.push(...machineItems.map((item) => this.normalizeTx(item)));

        if (items.length < limit) break;

        const total = root?.total ?? root?.total_results ?? null;
        if (total !== null && allTxs.length >= total) break;

        page++;
        if (page > 50) {
          this.logger.warn('[SyncMaquinetas] Limite de 50 páginas atingido');
          break;
        }
      } catch (err: any) {
        this.logger.error(`[SyncMaquinetas] Erro na página ${page}: ${err?.response?.status ?? err.message}`);
        break;
      }
    }

    return allTxs;
  }

  private isMachineTx(item: any): boolean {
    // Verifica serial_number direto
    if (item.serial_number && RENOVADA_MACHINE_SERIALS.includes(item.serial_number)) {
      return true;
    }
    // Verifica customer_name com padrão "Terminal: [SERIAL]"
    const name: string = item.customer?.name ?? item.customer_name ?? '';
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/i);
    if (m && RENOVADA_MACHINE_SERIALS.includes(m[1])) {
      return true;
    }
    // Verifica origin fisical + document Renovada
    if (item.origin === 'FISICAL') {
      const doc: string = item.customer?.document ?? item.customer_document ?? '';
      const docClean = doc.replace(/\D/g, '');
      if (docClean === '44522660000108') return true;
    }
    return false;
  }

  private extractSerial(item: any): string {
    if (item.serial_number && RENOVADA_MACHINE_SERIALS.includes(item.serial_number)) {
      return item.serial_number;
    }
    const name: string = item.customer?.name ?? item.customer_name ?? '';
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/i);
    if (m) return m[1];
    return item.serial_number ?? 'DESCONHECIDO';
  }

  private normalizeTx(item: any): any {
    const amountRaw = typeof item.amount === 'number' ? item.amount : Number(item.amount ?? 0);
    const liquidRaw = typeof item.liquid_amount === 'number' ? item.liquid_amount : Number(item.liquid_amount ?? 0);

    return {
      id: item.id ?? item.order_id,
      created_at: item.created_at ?? item.createdAt,
      amount: amountRaw, // em centavos
      liquid_amount: liquidRaw, // em centavos
      status: item.status ?? 'paid',
      payment_method: item.payment_method ?? 'pix',
      installments: item.installments ?? 1,
      card_brand: item.card_brand ?? null,
      card_bin: item.card_bin ?? null,
      customer_name: item.customer?.name ?? item.customer_name ?? 'Cliente POS',
      customer_email: item.customer?.email ?? item.customer_email ?? '',
      customer_document: item.customer?.document ?? item.customer_document ?? '',
      customer_phone: item.customer?.mobile_phone ?? item.customer_phone ?? '',
      serial: this.extractSerial(item),
    };
  }
}
