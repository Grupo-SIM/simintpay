import { Inject, Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY, type IPaymentGateway, type DomTaxesOutput, type DomTransactionItem } from '../../../core/services/payment-gateway.interface';
import type { ListTransactionsQueryDto } from '../../dtos/transactions/list-transactions.query.dto';
import { stripInternalTags } from '../../utils/internal-tags.util';
import { getPlatformTaxaEffective, canonicalPlatformTaxaTag } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { estimateDomFeeReais, platformTaxaTagFromText } from '../../helpers/dom-fee-estimate.helper';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const BRT = 'America/Sao_Paulo';
const RENOVADA_HIDDEN_TAG = '[TENANT:RENOVADA]';
const EBOOK_TAG = '[TENANT:EBOOK]';

function formatDocument(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
}

function mapInternalStatusToPt(
  status: TransactionStatus,
): 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA' {
  switch (status) {
    case TransactionStatus.COMPLETED:
      return 'APROVADA';
    case TransactionStatus.PENDING:
    case TransactionStatus.DRAFT:
      return 'PENDENTE';
    case TransactionStatus.FAILED:
    case TransactionStatus.EXPIRED:
      return 'RECUSADA';
    case TransactionStatus.REFUNDED:
    case TransactionStatus.CHARGEBACK:
      return 'ESTORNADA';
    default:
      return 'PENDENTE';
  }
}

function mapDomStatusToTransactionStatus(status: string): TransactionStatus {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'approved' || s === 'completed') return TransactionStatus.COMPLETED;
  if (s === 'refunded' || s === 'chargeback') return TransactionStatus.REFUNDED;
  if (s === 'failed' || s === 'rejected' || s === 'expired') return TransactionStatus.FAILED;
  return TransactionStatus.PENDING;
}

function mapPtStatusToInternal(
  status: ListTransactionsQueryDto['status'],
): TransactionStatus[] | undefined {
  switch (status) {
    case 'APROVADA':
      return [TransactionStatus.COMPLETED];
    case 'PENDENTE':
      return [TransactionStatus.PENDING, TransactionStatus.DRAFT];
    case 'RECUSADA':
      return [TransactionStatus.FAILED, TransactionStatus.EXPIRED];
    case 'ESTORNADA':
      return [TransactionStatus.REFUNDED, TransactionStatus.CHARGEBACK];
    default:
      return undefined;
  }
}

function extractOrderNumber(value: string | null | undefined): string | null {
  const raw = String(value ?? '');
  const match = raw.match(/\bORD-\d{4}-\d+\b/i);
  return match ? match[0].toUpperCase() : null;
}

function parseDomDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const normalized = String(raw).trim().replace(' ', 'T');
  const withTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}-03:00`;
  const date = new Date(withTimezone);
  return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class ListTransactionsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) { }

  async execute(input: {
    userId: string;
    query: ListTransactionsQueryDto;
  }): Promise<{
    data: Array<{
      id: string;
      valor: number;
      valorLiquido: number | null;
      status: 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA';
      metodo: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD';
      descricao: string | null;
      parcelas: number;
      cliente: {
        nome: string | null;
        email: string | null;
        documento: string | null;
      };
      taxas: {
        total: number;
        dom: number;
        plataforma: number;
      };
      financeiro: {
        valor_bruto_venda: number;
        taxa_dom: number;
        taxa_vendedor: number;
        taxa_fixa_transacao: number;
        taxa_cashback: number;
        taxa_servico: number;
        valor_liquido_vendedor: number;
        lucro_master: number;
      };
      criadoEm: string;
      plataforma: string | null;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    // 1. Sincronizar com a DOM
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      include: { tenantModule: true },
    });
    if (!user) throw new Error('Usuário não encontrado');

    // Usuários criados via admin com CPF: transações vêm do pool Renovada filtradas pelo CPF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userCpf: string | null | undefined = (user as any).cpf;
    const tenantModuleSlug = user.tenantModule?.slug?.toLowerCase();
    const tenantTag = canonicalPlatformTaxaTag((tenantModuleSlug || 'GLOBAL').toUpperCase());
    const TAGS_SEM_TAXA_SERVICO = new Set(['BOSQUE']);
    const RENOVADA_TAXA_SERVICO_DATE = new Date('2026-05-29T20:40:00.000Z');
    const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-18T03:00:00.000Z');
    const fixedTx = getPlatformTaxaEffective(tenantTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
    const fixedCashback = getPlatformTaxaEffective(tenantTag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
    const fixedServico = TAGS_SEM_TAXA_SERVICO.has(tenantTag) ? 0 : getPlatformTaxaEffective(tenantTag, 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);
    const fixedFeesTotal = fixedTx + fixedCashback + fixedServico;

    // 2. Resolver o Token (Prioridade: User > Módulo)
    // NÃO usar master token aqui — ele traz transações de TODAS as plataformas.
    // Para Renovada, o sync acontece via CRON dedicado (RenovadaSyncService).
    // Para usuários com CPF: não sincronizar via DOM, usam pool Renovada.
    let domToken: string | null | undefined = userCpf ? null : user.domToken;
    let source = 'Individual';

    if (!domToken && user?.tenantModuleId) {
      const module = await this.prisma.tenantModule.findUnique({ where: { id: user.tenantModuleId } });
      // Renovada usa RenovadaSyncService (cron dedicado) — não sincronizar aqui para evitar
      // que transações de outros tenants sejam atribuídas à Renovada via token de módulo.
      if (module && module.slug !== 'renovada') {
        domToken = process.env[`${module.slug.toUpperCase()}_DOM_TOKEN`];
        source = `Módulo (${module.slug})`;
      }
    }

    // NÃO fazer fallback para master token:
    // O master token retorna transações de TODAS as plataformas,
    // não apenas as do usuário logado. A sync automática cuida disso.
    // if (!domToken) { domToken = process.env.DOM_TOKEN; } // ← REMOVIDO

    if (domToken) {
      try {
        console.log(`[Sync List] Sincronizando via ${source}...`);
        const domRes = await this.gateway.listDomTransactions(domToken, { page: 1, limit: 100 });

        // Fetch Dom tax rates once so we can calculate domFee per transaction
        // (the list endpoint does not return mdr_value)
        let domTaxes: DomTaxesOutput | null = null;
        const masterKey = process.env.API_DOM_MASTER_KEY;
        if (masterKey) {
          try {
            domTaxes = await this.gateway.getTaxes(masterKey);
          } catch (err: any) {
            console.error('[Sync] Failed to fetch taxes:', err.message);
          }
        }

        const RENOVADA_ID_SYNC = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
        const RENOVADA_KEYWORDS = [
          'dizimo',
          'dízimo',
          'primicia',
          'primícia',
          'oferta',
          'fundacao',
          'fundação',
          'maquineta',
          'terminal',
          RENOVADA_HIDDEN_TAG.toLowerCase(),
        ];

        for (const item of domRes.transactions) {
          // Para a conta Renovada, ignorar transações sem keywords — o CRON dedicado gerencia isso
          if (user.id === RENOVADA_ID_SYNC) {
            const desc = (item.product_first || '').toLowerCase();
            if (!RENOVADA_KEYWORDS.some(k => desc.includes(k))) continue;
          }

          // O Gateway agora já retorna os valores em REAIS
          const amount = new Prisma.Decimal(item.amount);

          // Prefer taxa DOM da API quando > 0; 0/null é comum na listagem DOM — recalcula.
          const domFromList = Number(item.dom_fee ?? item.mdr_value ?? 0);
          let calcDomFee: Prisma.Decimal | undefined =
            Number.isFinite(domFromList) && domFromList > 0 ? new Prisma.Decimal(domFromList) : undefined;

          if (!calcDomFee && domTaxes) {
            const isCard = item.payment_method?.toUpperCase().includes('CARD');
            const amt = item.amount; // em reais
            if (!isCard && domTaxes.pix) {
              const pct = domTaxes.pix.percentual ?? 0;
              const fixed = domTaxes.pix.fixo ?? 0;
              calcDomFee = new Prisma.Decimal(amt * (pct / 100) + fixed);
            } else if (isCard && domTaxes.cartaoCredito?.tabelaParcelas) {
              const installments = item.installments ?? 1;
              const row = domTaxes.cartaoCredito.tabelaParcelas.find(r => Number(r.parcelas) === installments);
              if (row) calcDomFee = new Prisma.Decimal(amt * (parseFloat(row.taxaDom) / 100));
            }
          }
          if (!calcDomFee) {
            const tag = platformTaxaTagFromText(item.product_first ?? undefined);
            calcDomFee = new Prisma.Decimal(
              estimateDomFeeReais({
                amountReais: item.amount,
                paymentMethod: item.payment_method,
                installments: item.installments,
                tenantTag: tag,
              }),
            );
          }

          // Ajuste fixo de toda transação: R$ 1,00 + R$ 3,00 no back.
          // Ex.: PIX de R$1,00 com MDR 0,98% => líquido ~ -R$3,01.
          const netAmount = calcDomFee
            ? amount.sub(calcDomFee).sub(fixedFeesTotal)
            : new Prisma.Decimal(item.liquid_amount ?? 0).sub(fixedFeesTotal);
          const totalFee = amount.sub(netAmount);
          const calcPlatformFee = calcDomFee
            ? totalFee.sub(calcDomFee)
            : new Prisma.Decimal(fixedFeesTotal);

          const parsedDate = item.created_at
            ? new Date(item.created_at.replace(' ', 'T'))
            : new Date();
          const createdAt = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

          // order_id é o identificador aceito pelo endpoint /front-store/transaction/{id} do DOM
          const domPaymentId = item.order_id || item.cod_external || item.id;

          const updateData = {
            status: mapDomStatusToTransactionStatus(item.status),
            amount,
            netAmount,
            totalFee,
            ...(calcDomFee !== undefined && { domFee: calcDomFee }),
            ...(calcPlatformFee !== undefined && { platformFee: calcPlatformFee }),
            customerName: item.customer_name,
            customerEmail: item.customer_email,
            customerDocument: item.customer_document,
            customerPhone: item.customer_phone,
            updatedAt: new Date(),
          };

          try {
            // Busca por domPaymentId OU por domTransactionId (fallback para registros antigos
            // criados com chave diferente — evita falha silenciosa por conflito de uniqueness)
            const existing = await this.prisma.transaction.findFirst({
              where: {
                OR: [
                  { domPaymentId },
                  ...(item.id ? [{ domTransactionId: item.id }] : []),
                ],
              },
              select: { id: true },
            });

            if (existing) {
              await this.prisma.transaction.update({
                where: { id: existing.id },
                data: updateData,
              });
            } else {
              await this.prisma.transaction.create({
                data: {
                  userId: user.id,
                  ...updateData,
                  paymentMethod: item.payment_method?.toUpperCase().includes('CARD') ? PaymentMethod.CREDIT_CARD : PaymentMethod.PIX,
                  domTransactionId: item.id,
                  domPaymentId,
                  description: item.product_first,
                  createdAt,
                },
              });
            }
          } catch (err: any) {
            console.error(`Erro ao sincronizar transação ${item.id}:`, err.message);
          }
        }
      } catch (err: any) {
        console.error('[Sync Error]', err.message);
      }
    }
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;

    const moduleSlug = user.tenantModule?.slug?.toLowerCase();
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    let and: Prisma.TransactionWhereInput[];

    if (userCpf) {
      // Conta criada via admin:
      // 1) transações do pool Renovada filtradas por CPF na descrição
      // 2) transações já atribuídas diretamente ao próprio usuário
      const cpfDigits = userCpf.replace(/\D/g, '');
      const cpfFormatted = cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      and = [
        {
          OR: [
            {
              AND: [
                { userId: RENOVADA_ID },
                {
                  OR: [
                    { description: { contains: cpfDigits, mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: cpfFormatted, mode: Prisma.QueryMode.insensitive } },
                  ],
                },
              ],
            },
            { userId: input.userId },
          ],
        },
      ];
    } else {
      const filterPlanTransactions = moduleSlug === 'renovada';
      const isBosque = moduleSlug === 'bosque';
      and = [
        { userId: input.userId },
        ...(filterPlanTransactions
          ? [
              {
                OR: [
                  { description: { contains: 'dizimo', mode: Prisma.QueryMode.insensitive } },
                  { description: { contains: 'dízimo', mode: Prisma.QueryMode.insensitive } },
                  { description: { contains: 'primicia', mode: Prisma.QueryMode.insensitive } },
                  { description: { contains: 'primícia', mode: Prisma.QueryMode.insensitive } },
                  { description: { contains: 'oferta', mode: Prisma.QueryMode.insensitive } },
                  { description: { contains: 'fundacao', mode: Prisma.QueryMode.insensitive } },
                  { description: { contains: 'fundação', mode: Prisma.QueryMode.insensitive } },
                  { description: { contains: RENOVADA_HIDDEN_TAG, mode: Prisma.QueryMode.insensitive } },
                ],
              },
              // Excluir maquinetas/terminais (têm rota própria /maquinetas)
              {
                NOT: {
                  OR: [
                    { description: { contains: 'maquineta', mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: 'terminal:', mode: Prisma.QueryMode.insensitive } },
                  ],
                },
              },
              // Excluir ajustes administrativos/sincronizações de saldo
              {
                NOT: {
                  OR: [
                    { description: { contains: 'Sincronização de Saldo', mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: 'Ajuste Administrativo', mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: 'balance sync', mode: Prisma.QueryMode.insensitive } },
                  ],
                },
              },
            ]
          : isBosque
          ? [
              // Excluir transações de sincronização/ajuste do Bosque
              {
                NOT: {
                  OR: [
                    { description: { contains: 'Sincronização Bosque', mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: 'Sincronizacao Bosque', mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: 'Ajuste Administrativo', mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: 'balance sync', mode: Prisma.QueryMode.insensitive } },
                  ],
                },
              },
            ]
          : []),
      ];
    }

    const statuses = mapPtStatusToInternal(input.query.status);
    if (statuses) {
      and.push({ status: { in: statuses } });
    }

    if (input.query.metodo) {
      and.push({
        paymentMethod:
          input.query.metodo === 'PIX'
            ? PaymentMethod.PIX
            : PaymentMethod.CREDIT_CARD,
      });
    }

    const q = input.query.q?.trim();
    if (q && q.length > 0) {
      and.push({
        OR: [
          { id: { contains: q, mode: 'insensitive' } },
          { domTransactionId: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { customerEmail: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { customerDocument: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (input.query.id) {
      and.push({
        OR: [
          { id: { contains: input.query.id, mode: 'insensitive' } },
          { domTransactionId: { contains: input.query.id, mode: 'insensitive' } },
        ],
      });
    }

    if (input.query.customerName) {
      and.push({ customerName: { contains: input.query.customerName, mode: 'insensitive' } });
    }

    if (input.query.customerEmail) {
      and.push({ customerEmail: { contains: input.query.customerEmail, mode: 'insensitive' } });
    }

    if (input.query.customerDocument) {
      and.push({ customerDocument: { contains: input.query.customerDocument, mode: 'insensitive' } });
    }

    if (input.query.domTransactionId) {
      and.push({ domTransactionId: { contains: input.query.domTransactionId, mode: 'insensitive' } });
    }

    if (input.query.dataInicio || input.query.dataFim) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (input.query.dataInicio) {
        const d = dayjs.tz(input.query.dataInicio, BRT).startOf('day').toDate();
        if (!Number.isNaN(d.getTime())) {
          createdAt.gte = d;
        }
      }
      if (input.query.dataFim) {
        const d = dayjs.tz(input.query.dataFim, BRT).endOf('day').toDate();
        if (!Number.isNaN(d.getTime())) {
          createdAt.lte = d;
        }
      }
      and.push({ createdAt });
    }

    const where: Prisma.TransactionWhereInput = { AND: and };

    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Para transações EBOOK, prioriza cliente vindo do checkout da DOM.
    let domByOrderNumber = new Map<string, DomTransactionItem[]>();
    try {
      const ebookItems = items.filter((t) => (t.description ?? '').includes(EBOOK_TAG));
      if (ebookItems.length > 0) {
        const domToken = process.env.API_DOM_MASTER_KEY || process.env.DOM_TOKEN;
        if (domToken?.trim()) {
          const minCreated = new Date(Math.min(...ebookItems.map((t) => t.createdAt.getTime())));
          const maxCreated = new Date(Math.max(...ebookItems.map((t) => t.createdAt.getTime())));
          const endMoment = dayjs(maxCreated).add(2, 'day');
          const beginCandidate = dayjs(minCreated).subtract(2, 'day');
          const minAllowedBegin = dayjs(endMoment).subtract(3, 'month');
          const beginMoment = beginCandidate.isBefore(minAllowedBegin) ? minAllowedBegin : beginCandidate;
          const beginDate = beginMoment.format('YYYY-MM-DD');
          const endDate = endMoment.format('YYYY-MM-DD');

          const limitDom = 150;
          for (let domPage = 1; domPage <= 12; domPage += 1) {
            const res = await this.gateway.listDomTransactions(domToken, {
              page: domPage,
              limit: limitDom,
              begin_date: beginDate,
              end_date: endDate,
            });
            const batch = res.transactions ?? [];
            for (const tx of batch) {
              const order = extractOrderNumber(tx.product_first);
              if (!order) continue;
              const list = domByOrderNumber.get(order) ?? [];
              list.push(tx);
              domByOrderNumber.set(order, list);
            }
            if (batch.length < limitDom) break;
          }
        }
      }
    } catch {
      domByOrderNumber = new Map<string, DomTransactionItem[]>();
    }

    return {
      data: items.map((t) => {
        let customerName = t.customerName ?? null;
        let customerEmail = t.customerEmail ?? null;
        let customerDocument = t.customerDocument ?? null;

        if ((t.description ?? '').includes(EBOOK_TAG)) {
          const order = extractOrderNumber(t.description);
          const candidates = order ? domByOrderNumber.get(order) ?? [] : [];
          if (candidates.length > 0) {
            const txCreatedAt = t.createdAt.getTime();
            let best = candidates[0];
            let bestDistance = Number.MAX_SAFE_INTEGER;
            for (const candidate of candidates) {
              const candDate = parseDomDate(candidate.created_at);
              const dist = candDate ? Math.abs(candDate.getTime() - txCreatedAt) : Number.MAX_SAFE_INTEGER - 1;
              if (dist < bestDistance) {
                bestDistance = dist;
                best = candidate;
              }
            }
            customerName = best.customer_name ?? customerName;
            customerEmail = best.customer_email ?? customerEmail;
            customerDocument = best.customer_document ?? customerDocument;
          }
        }

        const amount = Number(t.amount);
        const rowTenantTag = platformTaxaTagFromText(t.description ?? undefined);
        const feeTag = rowTenantTag !== 'GLOBAL' ? rowTenantTag : tenantTag;
        const LRow = getPlatformTaxaEffective(feeTag, 'LIQUIDEZ', PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);

        const taxaVendedor = Number(Math.max(0, amount * (1 - LRow)).toFixed(2));
        const rowServicoRate = TAGS_SEM_TAXA_SERVICO.has(feeTag)
          ? 0
          : getPlatformTaxaEffective(feeTag, 'TAXA_SERVICO', PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO);
        const rowServicoEffDate = feeTag === 'RENOVADA' ? RENOVADA_TAXA_SERVICO_DATE : TAXA_SERVICO_EFFECTIVE_DATE;
        const rowServico = rowServicoRate > 0 && t.createdAt >= rowServicoEffDate ? rowServicoRate : 0;
        const valorLiquidoVendedor = Number((amount - taxaVendedor - rowServico).toFixed(2));

        return {
          id: t.id,
          valor: amount,
          valorLiquido: valorLiquidoVendedor,
          status: mapInternalStatusToPt(t.status),
          metodo: t.paymentMethod,
          descricao: stripInternalTags(t.description),
          parcelas: t.installments,
          cliente: {
            nome: customerName,
            email: customerEmail,
            documento: formatDocument(customerDocument),
          },
          taxas: {
            total: Number((taxaVendedor + rowServico).toFixed(2)),
            dom: 0,
            plataforma: Number((taxaVendedor + rowServico).toFixed(2)),
          },
          financeiro: {
            valor_bruto_venda: Number(amount.toFixed(2)),
            taxa_dom: 0,
            taxa_vendedor: taxaVendedor,
            taxa_fixa_transacao: 0,
            taxa_cashback: 0,
            taxa_servico: rowServico,
            valor_liquido_vendedor: valorLiquidoVendedor,
            lucro_master: 0,
          },
          criadoEm: t.createdAt.toISOString(),
          plataforma: feeTag !== 'GLOBAL' ? feeTag : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }
}
