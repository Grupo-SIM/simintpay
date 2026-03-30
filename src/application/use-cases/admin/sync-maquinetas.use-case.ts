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

  async execute(daysBack?: number): Promise<{
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
    const allMachineTxs = await this.fetchAllMachineTxsFromDom(domToken, daysBack);
    this.logger.log(`[SyncMaquinetas] Encontradas ${allMachineTxs.length} transações de maquinetas na DOM`);

    let synced = 0;
    let skipped = 0;
    let errors = 0;
    let totalAmount = 0;

    for (const tx of allMachineTxs) {
      try {
        const amountReais = tx.amount; // DOM envia em Reais (ex: 25.00) para máquinas
        const liquidReais = (tx.liquid_amount && tx.liquid_amount > 0) ? tx.liquid_amount : amountReais;
        const domFeeAmt = amountReais - liquidReais; // MDR cobrado pela DOM
        const platformFeeAmt = liquidReais * TAXA_MAQUINETA; // 9% sobre o líquido
        const netbalancemachine = liquidReais * (1 - TAXA_MAQUINETA); // liquid × 0.91
        const serial = tx.serial;

        // Verificar se já existe no banco (pela domPaymentId que é UNICA)
        const existing = await this.prisma.transaction.findUnique({
          where: { domPaymentId: tx.id },
        });

        if (existing) {
          const oldAmount = existing.amount.toNumber();
          const diff = amountReais - oldAmount;

          const oldNet = existing.netAmount?.toNumber() ?? (existing.amount.toNumber() * (1 - TAXA_MAQUINETA));
          const netDiffCheck = Math.abs(netbalancemachine - oldNet);
          const shouldCorrectNet = netDiffCheck >= 0.01;
          const hasMissingFields = !existing.customerDocument || !existing.domTransactionId || !(existing as any).cardCodeAuth;

          // Se o valor bruto estiver OK e o net também, verifica só campos faltantes
          if (Math.abs(diff) < 0.001 && !shouldCorrectNet) {
            if (hasMissingFields) {
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: {
                  // Só atualiza domTransactionId se ainda não está preenchido (evita unique constraint)
                  ...(!existing.domTransactionId && tx.cod_external ? { domTransactionId: tx.cod_external } : {}),
                  customerEmail: tx.customer_email,
                  customerDocument: tx.customer_document,
                  customerPhone: tx.customer_phone,
                  cardBrand: tx.card_brand,
                  cardBin: tx.card_bin,
                  cardCodeAuth: tx.card_code_auth,
                },
              });
              synced++;
              continue;
            }
            skipped++;
            continue;
          }

          // Se o valor estiver errado (ex: 0.25 vs 25.00), vamos CORRIGIR!
          this.logger.log(`[SyncMaquinetas] Corrigindo transação ${tx.id}: R$${oldAmount} -> R$${amountReais} (Dif: R$${diff.toFixed(2)})`);

          await this.prisma.$transaction(async (p) => {
            // 1. Atualizar a transação
            await p.transaction.update({
              where: { id: existing.id },
              data: {
                amount: new Prisma.Decimal(amountReais),
                netAmount: new Prisma.Decimal(netbalancemachine),
                totalFee: new Prisma.Decimal(domFeeAmt + platformFeeAmt),
                domFee: new Prisma.Decimal(domFeeAmt),
                platformFee: new Prisma.Decimal(platformFeeAmt),
                description: `Maquineta (CORRIGIDA) - Terminal: ${serial}`,
                domTransactionId: tx.cod_external || null,
                customerEmail: tx.customer_email,
                customerDocument: tx.customer_document,
                customerPhone: tx.customer_phone,
              },
            });

            // 2. Ajustar saldo da carteira com a DIFERENÇA de netbalancemachine
            // wallet.balance acumula netbalancemachine (= liquidReais × (1 - TAXA_MAQUINETA)).
            // oldNet = netAmount armazenado = o que foi adicionado ao wallet na última sync.
            const currentWallet = await p.wallet.findUnique({ where: { userId: RENOVADA_ID } });
            if (currentWallet) {
              const oldNet = existing.netAmount?.toNumber() ?? (existing.amount.toNumber() * (1 - TAXA_MAQUINETA));
              const diffNet = netbalancemachine - oldNet;
              const newBalance = currentWallet.balance.add(new Prisma.Decimal(diffNet));
              await p.wallet.updateMany({
                where: { id: currentWallet.id, version: currentWallet.version },
                data: { balance: newBalance, version: { increment: 1 } },
              });

              await p.balanceLog.create({
                data: {
                  userId: RENOVADA_ID,
                  action: 'MAQUINETA_CORRECTION',
                  transactionId: existing.id,
                  amount: new Prisma.Decimal(diffNet),
                  balanceBefore: currentWallet.balance,
                  balanceAfter: newBalance,
                  lockedBefore: currentWallet.lockedBalance,
                  lockedAfter: currentWallet.lockedBalance,
                  source: 'MAQUINETA_SYNC',
                  description: `Ajuste net: R$${oldNet.toFixed(2)} -> R$${netbalancemachine.toFixed(2)} (diff: R$${diffNet.toFixed(2)})`,
                },
              });
            }
          });

          synced++;
          totalAmount += diff;
          continue;
        }

        // --- NOVA TRANSAÇÃO ---
        const pm = String(tx.payment_method ?? '').toLowerCase();
        // TODO: mudar CREDIT_CARD para DEBIT_CARD quando rodar: prisma migrate dev + prisma generate
        const paymentMethod = (pm.includes('card') || pm.includes('debit') || pm.includes('credit'))
          ? PaymentMethod.CREDIT_CARD
          : PaymentMethod.PIX;

        await this.prisma.$transaction(async (p) => {
          const newTx = await p.transaction.create({
            data: {
              userId: RENOVADA_ID,
              domPaymentId: tx.id,
              domTransactionId: tx.cod_external || null, // null para PIX sem cod_external
              amount: new Prisma.Decimal(amountReais),
              netAmount: new Prisma.Decimal(netbalancemachine),
              totalFee: new Prisma.Decimal(domFeeAmt + platformFeeAmt),
              domFee: new Prisma.Decimal(domFeeAmt),
              platformFee: new Prisma.Decimal(platformFeeAmt),
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
              cardCodeAuth: tx.card_code_auth ?? null,
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

          // wallet.balance armazena o netBalance = netbalancemachine = liquidReais × (1 - TAXA_MAQUINETA)
          const currentWallet = await p.wallet.findUnique({ where: { userId: RENOVADA_ID } });
          if (currentWallet) {
            const newBalance = currentWallet.balance.add(new Prisma.Decimal(netbalancemachine));
            await p.wallet.updateMany({
              where: { id: currentWallet.id, version: currentWallet.version },
              data: { balance: newBalance, version: { increment: 1 } },
            });
            await p.balanceLog.create({
              data: {
                userId: RENOVADA_ID,
                action: 'MAQUINETA_SYNC',
                transactionId: newTx.id,
                amount: new Prisma.Decimal(netbalancemachine),
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

  /** Busca transações pagas de maquinetas diretamente da DOM Pagamentos.
   * @param daysBack - Se informado, limita a busca aos últimos N dias (para uso no cron).
   *                   Se omitido, usa MAQUINETA_SYNC_BEGIN_DATE ou 30 dias (sync completo). */
  private async fetchAllMachineTxsFromDom(domToken: string, daysBack?: number): Promise<any[]> {
    const baseUrl = (process.env.DOM_REAL_API_URL ?? 'https://apiv3.dompagamentos.com.br/checkout/production').replace(/\/$/, '');
    const url = `${baseUrl}/transactions`;

    let beginDate: string;
    if (daysBack) {
      beginDate = dayjs().subtract(daysBack, 'day').format('YYYY-MM-DD');
    } else {
      // Forçar 30 dias se não houver data no env, ou se a data do env for muito antiga (2024, etc)
      const envDate = process.env.MAQUINETA_SYNC_BEGIN_DATE;
      beginDate = (envDate && !envDate.startsWith('2024'))
        ? envDate
        : dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    }
      
    const endDate = dayjs().format('YYYY-MM-DD');

    this.logger.log(`[SyncMaquinetas] Rodando busca na DOM: ${beginDate} até ${endDate} (URL: ${url})`);

    const headers = {
      Authorization: `Bearer ${domToken}`,
      'x-access-token': domToken,
      Accept: 'application/json',
    };

    const allTxs: any[] = [];
    let page = 1;
    const limit = 50; // Reduzido para 50 para evitar sobrecarga no master token

    while (true) {
      try {
        const params = {
          page,
          limit,
          begin_date: beginDate,
          end_date: endDate,
        };
        
        this.logger.debug(`[SyncMaquinetas] GET Page ${page} Params: ${JSON.stringify(params)}`);

        const res = await firstValueFrom(
          this.http.get<any>(url, {
            headers,
            params,
          }),
        );

        const root = res.data;
        const items = root?.transactions || root?.data || (Array.isArray(root) ? root : []);

        if (!items || items.length === 0) {
          this.logger.log(`[SyncMaquinetas] Página ${page} sem itens.`);
          break;
        }

        this.logger.log(`[SyncMaquinetas] Página ${page}: Recebidos ${items.length} itens brutos.`);

        // Filtrar apenas transações de maquinetas
        let machineCountInPage = 0;
        for (const item of items) {
          const s = String(item.status ?? '').toLowerCase();
          const isSuccessful = s === 'paid' || s === 'approved' || s === 'completed';

          if (isSuccessful && this.isMachineTx(item)) {
            allTxs.push(this.normalizeTx(item));
            machineCountInPage++;
          }
        }
        
        this.logger.log(`[SyncMaquinetas] Página ${page}: ${machineCountInPage} identificados como máquina (pagas/aprovadas).`);

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
        if (err?.response?.data) {
          this.logger.error(`[SyncMaquinetas] Detalhes do erro: ${JSON.stringify(err.response.data)}`);
        }
        break;
      }
    }

    return allTxs;
  }

  /**
   * Identifica se uma transação da DOM é de maquineta (POS).
   * Lógica: type_operation === 'fisical' E doc === CNPJ Renovada
   */
  private isMachineTx(item: any): boolean {
    const typeOp = String(item.type_operation ?? '').toLowerCase();
    const doc = String(item.customer_document ?? item.customer?.document ?? '').replace(/\D/g, '');
    const email = String(item.customer_email ?? item.customer?.email ?? '').toLowerCase();

    // 1. Prioridade: Operação física + CNPJ da Renovada OU email de maquineta
    // (Para PIX via POS, customer_document pode ser o CPF do pagador — não o CNPJ da Renovada)
    if (typeOp === 'fisical' && (doc === '44522660000108' || email.includes('maquininha'))) {
      return true;
    }

    // 2. Fallback: Se tiver serial e estiver na lista cadastrada
    const serial = String(item.serial_number ?? item.terminal_serial ?? '').toUpperCase();
    if (serial && serial !== 'SEM-SERIAL' && RENOVADA_MACHINE_SERIALS.includes(serial)) {
      return true;
    }

    // 3. Fallback: Se o nome do cliente for "Cliente POS" ou conter um dos nossos seriais
    const name = String(item.customer?.name ?? item.customer_name ?? '').toUpperCase();
    if (name === 'CLIENTE POS' || name === 'PAYWAVE/VISA') {
      return true;
    }

    return false;
  }
  private extractSerial(item: any): string {
    const serial = String(item.serial_number ?? item.terminal_serial ?? '').toUpperCase();
    if (serial && serial !== 'SEM-SERIAL') return serial;

    const name = String(item.customer?.name ?? item.customer_name ?? '').toUpperCase();
    const m = name.match(/Terminal:\s*([A-Z0-9]+)/i);
    if (m) return m[1];

    return 'POS-MIG-RENOVADA';
  }

  private normalizeTx(item: any): any {
    // A DOM traz amount em valor real (ex: 25.00), mas salvamos bruto
    const amountRaw = Number(item.amount ?? 0);
    const liquidRaw = Number(item.liquid_amount ?? 0);

    return {
      id: item.id ?? item.order_id,
      created_at: item.created_at ?? item.createdAt,
      updated_at: item.updated_at ?? item.updatedAt ?? item.created_at,
      amount: amountRaw, 
      liquid_amount: liquidRaw, 
      status: item.status ?? 'paid',
      status_details: item.status_details ?? 'Aprovado',
      payment_method: item.payment_method ?? 'credit_card',
      installments: item.installments ?? 1,
      card_brand: item.card_brand ?? null,
      card_bin: item.card_bin ?? null,
      card_code_auth: item.card_code_auth ?? null,
      customer_name: item.customer?.name ?? item.customer_name ?? 'Cliente POS',
      customer_email: item.customer?.email ?? item.customer_email ?? '',
      customer_document: item.customer?.document ?? item.customer_document ?? '44522660000108',
      customer_phone: item.customer?.mobile_phone ?? item.customer_phone ?? '',
      // Para PIX via POS, cod_external é null — usa o E2E ID (card_code_auth) como referência única
      // Nunca usar '' como fallback: string vazia viola o unique constraint de domTransactionId
      cod_external: item.cod_external || item.external_id || item.nsu || item.card_code_auth || null,
      type_operation: item.type_operation ?? 'fisical',
      serial: this.extractSerial(item),
    };
  }
}
