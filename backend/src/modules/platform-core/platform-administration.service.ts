import { readPlatformBalanceSummary } from './platform-balance-summary';
import {
  coproductionOwnerNet,
  snapshotFrom,
} from '../coproduction/coproduction';
import { isDeliveryAllocationSnapshot } from '../integrations/delivery-payment-allocation';
import {
  transactionPlatformTag,
  whereTransactionPlatform,
} from './transaction-platform';
import type { PlatformContext } from './platform-context.service';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { getAtlasProductType } from '../../modules/atlas/utils/atlas-product-description.util';
import dayjs from 'dayjs';

import {
  type DomTransactionItem,
  type IPaymentGateway,
} from '../../core/services/payment-gateway.interface';
import {
  getPlatformTaxaEffective,
  domCashbackReais,
} from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';
import {
  estimateDomFeeReais,
  estimatePhysicalDomFeeReais,
} from '../../application/helpers/dom-fee-estimate.helper';
import { isMaquinetaDescription } from '../../application/utils/internal-tags.util';
import {
  parseYmdSp,
  normalizePlatformTag,
  TZ,
  getTaxaServicoEffectiveDate,
  TAGS_SEM_TAXA_SERVICO,
} from './platform-administration.helpers';

function snapshotAcquirerProfit(tx: {
  financialSnapshot?: unknown;
  amount: unknown;
  netAmount?: unknown | null;
}): number | undefined {
  const snapshot = tx.financialSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return undefined;
  const fields = snapshot as Record<string, unknown>;
  const cost = fields.acquirerCost;
  if (!cost || typeof cost !== 'object' || Array.isArray(cost))
    return undefined;
  const realized = (cost as Record<string, unknown>).realizedCents;
  if (
    typeof realized !== 'number' ||
    !Number.isSafeInteger(realized) ||
    realized < 0
  )
    return undefined;
  const buyerCents = fields.buyerTotalCents;
  const buyerTotal =
    typeof buyerCents === 'number' &&
    Number.isSafeInteger(buyerCents) &&
    buyerCents >= 0
      ? buyerCents / 100
      : Number(tx.amount);
  return Number(
    (buyerTotal - Number(tx.netAmount ?? 0) - realized / 100).toFixed(2),
  );
}

/** Shared administration projections. Legacy HTTP permissions stay at alias boundary. */
export class PlatformAdministrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: IPaymentGateway,
    private readonly expectedContext?: PlatformContext,
  ) {}

  async getPlataformasSaldosResumo() {
    return { resumo: await readPlatformBalanceSummary(this.prisma) };
  }

  async listPlataformas() {
    const platforms = await this.prisma.platform.findMany({
      select: {
        id: true,
        tag: true,
        name: true,
        ownerUserId: true,
        isActive: true,
        createdAt: true,
        customerInterestRates: true,
        owner: {
          select: { id: true, name: true, email: true, cpf: true, cnpj: true },
        },
      },
      orderBy: { tag: 'asc' },
    });
    return {
      data: await Promise.all(
        platforms.map(async (platform) => ({
          ...platform,
          cpf: platform.owner.cpf ?? platform.owner.cnpj ?? '',
          firstSeen: platform.createdAt,
          plansCount: await this.prisma.pixCreditPlan.count({
            where: { tenantTag: platform.tag },
          }),
          transactionsCount: await this.prisma.transaction.count({
            where: whereTransactionPlatform(platform.tag),
          }),
        })),
      ),
    };
  }

  async getAtlasBreakdown(dataInicio?: string, dataFim?: string) {
    // Mesmo escopo da tabela e do consolidado: conta Atlas OU [TENANT:ATLAS].
    const where: any = {
      status: 'COMPLETED',
      ...(await this.getPlatformTransactionScope('ATLAS')),
    };
    if (dataInicio)
      where.createdAt = {
        ...where.createdAt,
        gte: parseYmdSp(dataInicio).startOf('day').toDate(),
      };
    if (dataFim)
      where.createdAt = {
        ...where.createdAt,
        lte: parseYmdSp(dataFim).endOf('day').toDate(),
      };

    const txs = await this.prisma.transaction.findMany({
      where,
      select: {
        amount: true,
        description: true,
        paymentMethod: true,
        customerEmail: true,
      },
    });

    const liquidez = getPlatformTaxaEffective('ATLAS', 'LIQUIDEZ', 0.91);
    const taxaFixa = getPlatformTaxaEffective(
      'ATLAS',
      'TAXA_FIXA_TRANSACAO',
      1.0,
    );
    const taxaCashback = domCashbackReais();

    const isDomain = (desc: string | null | undefined) =>
      getAtlasProductType(desc) === 'DOMAIN';

    const calcGroup = (group: typeof txs) => {
      let receita = 0,
        lucro = 0;
      const byMethod = new Map<string, { quantidade: number; valor: number }>();
      for (const t of group) {
        const bruto = Number(t.amount ?? 0);
        receita += bruto;
        lucro += bruto * (1 - liquidez) - taxaFixa - taxaCashback;
        const method = (t.paymentMethod ?? 'PIX').toUpperCase();
        const bucket =
          method === 'PIX'
            ? 'PIX'
            : method === 'DEBIT_CARD'
              ? 'DEBIT_CARD'
              : method === 'BOLETO'
                ? 'BOLETO'
                : 'CREDIT_CARD';
        const prev = byMethod.get(bucket) ?? { quantidade: 0, valor: 0 };
        byMethod.set(bucket, {
          quantidade: prev.quantidade + 1,
          valor: prev.valor + bruto,
        });
      }
      const LABELS: Record<string, string> = {
        PIX: 'Pix',
        CREDIT_CARD: 'Crédito',
        DEBIT_CARD: 'Débito',
        BOLETO: 'Boleto',
      };
      const distribuicaoMetodo = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO']
        .map((c) => {
          const e = byMethod.get(c) ?? { quantidade: 0, valor: 0 };
          return {
            codigo: c,
            nome: LABELS[c],
            quantidade: e.quantidade,
            valor: Number(e.valor.toFixed(2)),
            percentual:
              group.length > 0
                ? Number(((e.quantidade / group.length) * 100).toFixed(2))
                : 0,
          };
        })
        .filter((r) => r.quantidade > 0);
      return {
        receita: Number(receita.toFixed(2)),
        lucro: Number(lucro.toFixed(2)),
        quantidade: group.length,
        distribuicaoMetodo,
      };
    };

    const domainTxs = txs.filter((t) => isDomain(t.description));
    const hostTxs = txs.filter(
      (t) => getAtlasProductType(t.description) === 'HOSTING',
    );
    const otherTxs = txs.filter(
      (t) => getAtlasProductType(t.description) === null,
    );

    const byProduct = new Map<
      string,
      { receita: number; lucro: number; quantidade: number }
    >();
    for (const t of hostTxs) {
      const nome = t.description?.trim() || 'Produto Atlas';
      const e = byProduct.get(nome) ?? { receita: 0, lucro: 0, quantidade: 0 };
      const bruto = Number(t.amount ?? 0);
      byProduct.set(nome, {
        receita: Number((e.receita + bruto).toFixed(2)),
        lucro: Number(
          (e.lucro + bruto * (1 - liquidez) - taxaFixa - taxaCashback).toFixed(
            2,
          ),
        ),
        quantidade: e.quantidade + 1,
      });
    }

    const uniqueEmails = new Set(
      txs.map((t) => t.customerEmail).filter(Boolean),
    );

    return {
      clientesUnicos: uniqueEmails.size,
      dominios: calcGroup(domainTxs),
      hospedagem: {
        ...calcGroup(hostTxs),
        porProduto: Array.from(byProduct.entries())
          .map(([nome, s]) => ({ nome, ...s }))
          .sort((a, b) => b.receita - a.receita),
      },
      outros: calcGroup(otherTxs),
    };
  }

  async getPlataformaDistribuicaoMetodo(
    tag: string,
    dataInicio?: string,
    dataFim?: string,
  ) {
    const upperTag = normalizePlatformTag(tag);

    const baseWhere: any = await this.getPlatformTransactionScope(upperTag);

    baseWhere.status = 'COMPLETED';

    if (dataInicio || dataFim) {
      if (dataInicio)
        baseWhere.createdAt = {
          ...baseWhere.createdAt,
          gte: parseYmdSp(dataInicio).startOf('day').toDate(),
        };
      if (dataFim)
        baseWhere.createdAt = {
          ...baseWhere.createdAt,
          lte: parseYmdSp(dataFim).endOf('day').toDate(),
        };
    }

    if (upperTag === 'RENOVADA') {
      baseWhere.AND = [
        {
          OR: [
            { description: { contains: 'dizimo', mode: 'insensitive' } },
            { description: { contains: 'dízimo', mode: 'insensitive' } },
            { description: { contains: 'primicia', mode: 'insensitive' } },
            { description: { contains: 'primícia', mode: 'insensitive' } },
            { description: { contains: 'oferta', mode: 'insensitive' } },
            { description: { contains: 'maquineta', mode: 'insensitive' } },
            { description: { contains: 'terminal', mode: 'insensitive' } },
          ],
        },
      ];
    }

    const txs = await this.prisma.transaction.findMany({
      where: baseWhere,
      select: { paymentMethod: true, amount: true },
    });

    const mapCount = new Map<string, { count: number; total: number }>();
    for (const tx of txs) {
      const method = (tx.paymentMethod ?? 'UNKNOWN').toUpperCase();
      const bucket =
        method === 'PIX'
          ? 'PIX'
          : method === 'DEBIT_CARD'
            ? 'DEBIT_CARD'
            : 'CREDIT_CARD';
      const prev = mapCount.get(bucket) ?? { count: 0, total: 0 };
      mapCount.set(bucket, {
        count: prev.count + 1,
        total: prev.total + Number(tx.amount ?? 0),
      });
    }

    const total = txs.length;
    const LABELS: Record<string, string> = {
      PIX: 'Pix',
      CREDIT_CARD: 'Crédito',
      DEBIT_CARD: 'Débito',
    };
    const items = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD']
      .map((codigo) => {
        const entry = mapCount.get(codigo) ?? { count: 0, total: 0 };
        return {
          codigo,
          nome: LABELS[codigo],
          quantidade: entry.count,
          valor: Number(entry.total.toFixed(2)),
          percentual:
            total > 0 ? Number(((entry.count / total) * 100).toFixed(2)) : 0,
        };
      })
      .filter((row) => row.quantidade > 0)
      .sort((a, b) => b.quantidade - a.quantidade);

    return { total, items };
  }

  async listPlataformaTransacoes(
    tag: string,
    page = '1',
    pageSize = '20',
    status?: string,
    dataInicio?: string,
    dataFim?: string,
    codigoTransacao?: string,
    codigoReferencia?: string,
    compradorNome?: string,
    compradorDocumento?: string,
    compradorEmail?: string,
    periodType?: string,
    tipoTransacao?: string,
    metodoPagamento?: string,
  ) {
    const upperTag = normalizePlatformTag(tag);

    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);

    const where: any = await this.getPlatformTransactionScope(upperTag);

    const and: any[] = [];

    if (upperTag === 'RENOVADA') {
      and.push({
        OR: [
          { description: { contains: 'dizimo', mode: 'insensitive' } },
          { description: { contains: 'dízimo', mode: 'insensitive' } },
          { description: { contains: 'primicia', mode: 'insensitive' } },
          { description: { contains: 'primícia', mode: 'insensitive' } },
          { description: { contains: 'oferta', mode: 'insensitive' } },
          { description: { contains: 'maquineta', mode: 'insensitive' } },
          { description: { contains: 'terminal', mode: 'insensitive' } },
        ],
      });
    }

    if (status) {
      const statusUpper = status.toUpperCase();
      const statusMap: Record<string, string> = {
        PENDENTE: 'PENDING',
        COMPLETADA: 'COMPLETED',
        FALHADA: 'FAILED',
        REEMBOLSADA: 'REFUNDED',
        EXPIRADA: 'EXPIRED',
        RASCUNHO: 'DRAFT',
        APROVADA: 'COMPLETED',
        RECUSADA: 'FAILED',
        ESTORNADA: 'REFUNDED',
      };
      where.status = statusMap[statusUpper] ?? statusUpper;
    }

    if (codigoTransacao) where.id = codigoTransacao;
    if (codigoReferencia) where.domTransactionId = codigoReferencia;
    if (compradorNome)
      where.customerName = { contains: compradorNome, mode: 'insensitive' };
    if (compradorDocumento)
      where.customerDocument = {
        contains: compradorDocumento.replace(/\D/g, ''),
      };
    if (compradorEmail)
      where.customerEmail = { contains: compradorEmail, mode: 'insensitive' };
    if (metodoPagamento) where.paymentMethod = metodoPagamento;

    if (tipoTransacao === 'maquinetas') {
      and.push({
        OR: [
          { description: { contains: 'maquineta', mode: 'insensitive' } },
          { description: { contains: 'terminal', mode: 'insensitive' } },
        ],
      });
    } else if (tipoTransacao === 'online') {
      and.push({
        NOT: {
          OR: [
            { description: { contains: 'maquineta', mode: 'insensitive' } },
            { description: { contains: 'terminal', mode: 'insensitive' } },
          ],
        },
      });
    }

    if (dataInicio || dataFim) {
      const dateFilter: any = {};
      if (dataInicio) {
        const d = dayjs.tz(`${dataInicio} 00:00:00`, TZ);
        if (d.isValid()) dateFilter.gte = d.toDate();
      }
      if (dataFim) {
        const d = dayjs.tz(`${dataFim} 23:59:59`, TZ);
        if (d.isValid()) dateFilter.lte = d.toDate();
      }
      if (Object.keys(dateFilter).length > 0) {
        where.createdAt = dateFilter;
      }
    }

    if (and.length > 0) {
      where.AND = and;
    }

    const total = await this.prisma.transaction.count({ where });
    const items = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * size,
      take: size,
      include: {
        pixPlanOrder: {
          select: { pixCreditPlanId: true, customerDocument: true },
        },
      },
    });

    const liquidityFactor = getPlatformTaxaEffective(
      upperTag,
      'LIQUIDEZ',
      0.91,
    );
    const fixedFee = getPlatformTaxaEffective(
      upperTag,
      'TAXA_FIXA_TRANSACAO',
      0.0,
    );
    const cashbackFee = domCashbackReais(upperTag);

    // DOM fee deductions (R$1+R$3): nenhuma plataforma é isenta, alinhado a
    // /relatorios/plataforma-consolidado. BOSQUE era isenta aqui, o que zerava as colunas
    // Cashback/Taxa Transação - DOM e inflava o Lucro/Prejuízo em R$4/tx — agora segue a RENOVADA.
    const TAXA_DOM_FEE_EXEMPT = new Set<string>([]);
    // TAXA_SERVICO (R$4 Sim Int Pay): RENOVADA e BOSQUE cobram a partir de 2026-05-29 (trava por getTaxaServicoEffectiveDate).
    const TAXA_SERVICO_RATE_EXEMPT = new Set<string>([]);
    const taxaServicoFixa = TAXA_DOM_FEE_EXEMPT.has(upperTag)
      ? 0
      : getPlatformTaxaEffective(
          upperTag,
          'TAXA_FIXA_TRANSACAO',
          PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
        );
    const taxaServicoCashback = TAXA_DOM_FEE_EXEMPT.has(upperTag)
      ? 0
      : domCashbackReais(upperTag);
    const taxaServicoRate = TAXA_SERVICO_RATE_EXEMPT.has(upperTag)
      ? 0
      : getPlatformTaxaEffective(
          upperTag,
          'TAXA_SERVICO',
          PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
        );

    const domByOrderNumber = new Map<string, DomTransactionItem[]>();
    if (upperTag === 'EBOOK' && items.length > 0) {
      const parsedDates = items
        .map((t) => t.createdAt)
        .filter(
          (d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()),
        );
      const minCreated =
        parsedDates.length > 0
          ? new Date(Math.min(...parsedDates.map((d) => d.getTime())))
          : new Date();
      const maxCreated =
        parsedDates.length > 0
          ? new Date(Math.max(...parsedDates.map((d) => d.getTime())))
          : new Date();
      const endMoment = dayjs(maxCreated).add(2, 'day');
      const beginCandidate = dayjs(minCreated).subtract(2, 'day');
      // API da DOM aceita no máximo 3 meses por consulta.
      const minAllowedBegin = dayjs(endMoment).subtract(3, 'month');
      const beginMoment = beginCandidate.isBefore(minAllowedBegin)
        ? minAllowedBegin
        : beginCandidate;
      const beginDate = beginMoment.format('YYYY-MM-DD');
      const endDate = endMoment.format('YYYY-MM-DD');
      const domToken = process.env.DOM_TOKEN;
      if (domToken?.trim()) {
        const limit = 150;
        for (let domPage = 1; domPage <= 12; domPage += 1) {
          const res = await this.paymentGateway.listDomTransactions(domToken, {
            page: domPage,
            limit,
            begin_date: beginDate,
            end_date: endDate,
          });
          const batch = res.transactions ?? [];
          for (const tx of batch) {
            const orderNumber = this.extractOrderNumberFromText(
              tx.product_first,
            );
            if (!orderNumber) continue;
            const arr = domByOrderNumber.get(orderNumber) ?? [];
            arr.push(tx);
            domByOrderNumber.set(orderNumber, arr);
          }
          if (batch.length < limit) break;
        }
      }
    }

    const data = items.map((t) => {
      const valorBruto = Number(t.amount);
      const isCompleted = t.status === 'COMPLETED';
      const isDelivery = isDeliveryAllocationSnapshot(t.financialSnapshot);
      const isMaquineta = isMaquinetaDescription(t.description);
      const pmStr =
        t.paymentMethod === 'PIX'
          ? 'pix'
          : t.paymentMethod === 'DEBIT_CARD'
            ? 'debit_card'
            : t.paymentMethod === 'BOLETO'
              ? 'boleto'
              : 'credit_card';
      const physicalDom =
        isCompleted && isMaquineta
          ? estimatePhysicalDomFeeReais({
              amountReais: valorBruto,
              paymentMethod: t.paymentMethod,
              installments: t.installments,
              tenantTag: upperTag,
              cardBrand: t.cardBrand,
            })
          : null;
      // POS não registra cashback. A fixa DOM só existe para cartão/débito,
      // conforme a tabela POS; PIX físico não paga taxa fixa.
      const taxaFixa =
        isCompleted && !isDelivery
          ? (physicalDom?.fixa ?? Number(taxaServicoFixa.toFixed(2)))
          : 0;
      const taxaCashback =
        isCompleted && !isMaquineta && !isDelivery
          ? Number(taxaServicoCashback.toFixed(2))
          : 0;
      // Snapshot imutável salvo quando a venda foi criada. Recalcular com a
      // tabela atual alterava linhas históricas e fazia tabela/cards divergirem.
      const taxaDom = isCompleted
        ? physicalDom
          ? Number(physicalDom.pct.toFixed(2))
          : Number(t.acquirerFee ?? 0)
        : 0;
      const taxaSimIntPay = isCompleted ? Number(t.platformFee ?? 0) : 0;
      // Taxa de serviço é venda online. Maquineta já cobra somente a taxa POS
      // persistida em platformFee.
      const taxaServico =
        isCompleted &&
        !isMaquineta &&
        !isDelivery &&
        taxaServicoRate > 0 &&
        t.createdAt >= getTaxaServicoEffectiveDate(upperTag)
          ? Number(taxaServicoRate.toFixed(2))
          : 0;
      const snapshotProfit = snapshotAcquirerProfit(t);
      const lucroPrejuizo = isCompleted
        ? (snapshotProfit ??
          Number(
            (
              taxaSimIntPay +
              taxaServico -
              taxaDom -
              taxaFixa -
              taxaCashback
            ).toFixed(2),
          ))
        : 0;

      const cashbackDeduction =
        isMaquineta || isDelivery ? 0 : valorBruto * (cashbackFee / 100);
      const fallbackNet = Number(
        (valorBruto * liquidityFactor - fixedFee - cashbackDeduction).toFixed(
          2,
        ),
      );
      // lucroAdmin = taxaSimIntPay (receita SimIntPay) - custo DOM - cashback repassado.
      // No boleto o custo DOM é o taxaDom (3,49+1), não o fixo do PIX.
      const custoDomLucro = isDelivery
        ? taxaDom
        : isMaquineta || pmStr === 'boleto'
          ? taxaDom + taxaFixa
          : fixedFee;
      const lucroAdmin = isCompleted
        ? (snapshotProfit ??
          Number(
            (taxaSimIntPay - custoDomLucro - cashbackDeduction).toFixed(2),
          ))
        : 0;
      const netFromDb = t.netAmount != null ? Number(t.netAmount) : null;
      // Alguns registros antigos/com erro ficaram COMPLETED com netAmount=0.
      // Nesses casos, exibimos o líquido calculado pela liquidez da plataforma.
      const valorLiquidoBase = isDelivery
        ? (netFromDb ?? 0)
        : isCompleted && (netFromDb == null || netFromDb <= 0)
          ? isMaquineta
            ? Number((valorBruto - taxaSimIntPay).toFixed(2))
            : fallbackNet
          : (netFromDb ?? fallbackNet);
      const taxaServicoTotal =
        isMaquineta || isDelivery ? 0 : taxaServicoFixa + taxaServicoCashback;
      const valorLiquido = snapshotFrom(t.financialSnapshot as Prisma.JsonValue)
        ? Number(
            coproductionOwnerNet(
              t.financialSnapshot,
              new Prisma.Decimal(netFromDb ?? 0),
            ).toFixed(2),
          )
        : Number((valorLiquidoBase - taxaServicoTotal).toFixed(2));

      let reconciledCustomerName = t.customerName ?? null;
      let reconciledCustomerEmail = t.customerEmail ?? null;
      let reconciledCustomerDocument = t.customerDocument ?? null;
      if (upperTag === 'EBOOK') {
        const orderNumber = this.extractOrderNumberFromText(t.description);
        const domCandidates = orderNumber
          ? (domByOrderNumber.get(orderNumber) ?? [])
          : [];
        if (domCandidates.length > 0) {
          const txCreatedAt =
            t.createdAt instanceof Date ? t.createdAt.getTime() : Date.now();
          let best = domCandidates[0];
          let bestDistance = Number.MAX_SAFE_INTEGER;
          for (const candidate of domCandidates) {
            const candDate = this.parseDomCreatedAt(candidate.created_at);
            const dist = candDate
              ? Math.abs(candDate.getTime() - txCreatedAt)
              : Number.MAX_SAFE_INTEGER - 1;
            if (dist < bestDistance) {
              bestDistance = dist;
              best = candidate;
            }
          }
          reconciledCustomerName = best.customer_name ?? reconciledCustomerName;
          reconciledCustomerEmail =
            best.customer_email ?? reconciledCustomerEmail;
          reconciledCustomerDocument =
            best.customer_document ?? reconciledCustomerDocument;
        }
      }

      return {
        id: t.id,
        valorBruto: valorBruto,
        valorLiquido: valorLiquido,
        lucroAdmin: lucroAdmin,
        taxaDom,
        taxaSimIntPay,
        taxaFixa,
        taxaCashback,
        taxaServico,
        lucroPrejuizo,
        calculos: {
          valorLiquido:
            isDelivery || (t.netAmount != null && Number(t.netAmount) > 0)
              ? `Salvo no BD: R$ ${valorLiquido.toFixed(2)}`
              : `(${valorBruto.toFixed(2)} * ${liquidityFactor.toFixed(2)}) - Fixo ${fixedFee.toFixed(2)} - Cb ${cashbackFee.toFixed(2)}% = ${valorLiquido.toFixed(2)}`,
          lucroAdmin: isCompleted
            ? isDelivery
              ? `Taxa plataforma(${taxaSimIntPay.toFixed(2)}) - custo registrado(${taxaDom.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
              : pmStr === 'boleto'
                ? `Boleto SimIntPay(${taxaSimIntPay.toFixed(2)}) - DOM(${taxaDom.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
                : pmStr === 'credit_card'
                  ? `CC SimIntPay(${taxaSimIntPay.toFixed(2)}) - DOM fixo(${fixedFee.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
                  : pmStr === 'debit_card'
                    ? `Débito SimIntPay(${taxaSimIntPay.toFixed(2)}) - Fixo(${fixedFee.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
                    : `PIX(${valorBruto.toFixed(2)} × ${(1 - liquidityFactor).toFixed(4)}) - Fixo(${fixedFee.toFixed(2)}) - Cb(${cashbackDeduction.toFixed(2)}) = ${lucroAdmin.toFixed(2)}`
            : 'Aguardando confirmação do pagamento',
        },
        status: t.status,
        metodoPagamento: t.paymentMethod,
        descricao: (t.description ?? '')
          .replace(/\s*\[CPF:[^\]]*\|[^\]]+\]/g, '')
          .replace(/Terminal:\s*/gi, 'Maquineta '),
        cliente: {
          nome: reconciledCustomerName,
          email: reconciledCustomerEmail,
          documento: reconciledCustomerDocument,
        },
        taxas: isMaquineta
          ? {
              total: Number((taxaDom + taxaFixa + taxaSimIntPay).toFixed(2)),
              dom: Number((taxaDom + taxaFixa).toFixed(2)),
              plataforma: taxaSimIntPay,
            }
          : {
              total: Number(t.totalFee),
              dom: Number(t.acquirerFee),
              plataforma: Number(t.platformFee),
            },
        criadoEm: t.createdAt,
        atualizadoEm: t.updatedAt,
      };
    });

    return { data, page: pageNum, pageSize: size, total };
  }

  async getPlataformaConsolidado(
    tagParam?: string,
    startDate?: string,
    endDate?: string,
    metodoPagamento?: string,
    allowAtlasInternally = false,
  ) {
    const tag = normalizePlatformTag(tagParam ?? '');
    if (!tag || (tag === 'ATLAS' && !allowAtlasInternally)) {
      return { error: 'Use /admin/relatorios/atlas-consolidado for ATLAS' };
    }

    const effectiveStart =
      startDate ?? dayjs().tz(TZ).startOf('month').format('YYYY-MM-DD');

    // Nenhuma plataforma é isenta dos fees por transação. BOSQUE era isenta aqui, o que zerava
    // "Taxa por Transação - DOM", "Taxa Cashback - DOM" e deixava "Taxa - Sim Int Pay (%)" sem
    // descontar o MDR da DOM. Agora BOSQUE segue exatamente a mesma conta da RENOVADA:
    // DOM cobra R$1 fixo + R$3 cashback por transação e a SimInt repassa esses mesmos R$4.
    const TAXA_FIXA = getPlatformTaxaEffective(
      tag,
      'TAXA_FIXA_TRANSACAO',
      PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
    );
    const TAXA_CASHBACK = domCashbackReais(tag);
    const LIQUIDEZ = getPlatformTaxaEffective(
      tag,
      'LIQUIDEZ',
      PLATFORM_TAXA_DEFAULTS.LIQUIDEZ,
    );
    const TAXA_LINK_PERCENT = getPlatformTaxaEffective(
      tag,
      'TAXA_LINK_PERCENT',
      PLATFORM_TAXA_DEFAULTS.TAXA_LINK_PERCENT,
    );
    const TAXA_LINK_FIXA = getPlatformTaxaEffective(
      tag,
      'TAXA_LINK_FIXA',
      PLATFORM_TAXA_DEFAULTS.TAXA_LINK_FIXA,
    );
    // Taxa de serviço (R$4/tx) — usada no repasse direto (app: netAmount − taxaServico = amountWithoutAllFee).
    const TAXA_SERVICO_RATE = TAGS_SEM_TAXA_SERVICO.has(tag)
      ? 0
      : getPlatformTaxaEffective(
          tag,
          'TAXA_SERVICO',
          PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
        );
    const TAXA_SERVICO_DATE = getTaxaServicoEffectiveDate(tag);

    const computeBreakdown = (
      txs: {
        financialSnapshot?: unknown;
        amount: unknown;
        paymentMethod: string;
        installments: number;
        description?: string | null;
        platformTag?: string | null;
        netAmount?: unknown;
        acquirerFee?: unknown;
        mdrValue?: unknown;
        platformFee?: unknown;
        createdAt?: Date | null;
        cardBrand?: string | null;
        acquirer?: string;
        isStandalone?: boolean;
      }[],
    ) => {
      const qtd = txs.length;
      // Maquineta liquida por modelo próprio (netAmount = líquido pós-MDR × 0,91; 9% TAXA_MAQUINETA).
      // Recalcular como cartão-link infla o repasse ~9% (a maquineta aparecia quase pelo bruto cheio).
      // Solução: usar o netAmount REAL dessas transações — o mesmo que a carteira, a página de Máquinas
      // e o admin-renovada já usam. Assim o "Total de Repasse" bate com o admin.
      // Maquineta nem sempre tem a tag [ORIGEM:MAQUINETA] — a maioria é gravada só com "Terminal: XXX"
      // (sync-maquinetas, webhooks). Detecção canônica: isMaquinetaDescription (internal-tags.util).
      const isMaq = (t: { description?: string | null }) =>
        isMaquinetaDescription(t.description);
      const normalTxs = txs.filter((t) => !isMaq(t));
      const maqTxs = txs.filter(isMaq);

      // A criação de uma assinatura de workspace Teron registra a tentativa
      // antes da DOM confirmar a cobrança. Esses registros legados têm os
      // campos de taxas em zero, apesar de a mesma venda aparecer detalhada na
      // listagem da DOM. Zero é válido em links standalone, por isso este
      // fallback é limitado ao contrato Teron pago por cartão.
      const isTeronWorkspaceCardWithoutFeeSnapshot = (
        t: (typeof normalTxs)[number],
      ) => {
        const paymentMethod = String(t.paymentMethod ?? '').toLowerCase();
        const isCard =
          paymentMethod.includes('card') || paymentMethod.includes('credit');
        return (
          isCard &&
          transactionPlatformTag(t) === 'TERON' &&
          Number(t.platformFee ?? 0) === 0
        );
      };

      // ── Transações normais (app/link): fórmula por método de pagamento ──
      const taxaSimIntDaTransacao = (t: (typeof normalTxs)[number]) => {
        const amount = Number(t.amount);
        const reportedPlatformFee = Number(t.platformFee);
        if (
          Number.isFinite(reportedPlatformFee) &&
          !isTeronWorkspaceCardWithoutFeeSnapshot(t)
        ) {
          return Number(reportedPlatformFee.toFixed(2));
        }
        if (isTeronWorkspaceCardWithoutFeeSnapshot(t)) {
          return Number(
            (amount * TAXA_LINK_PERCENT + TAXA_LINK_FIXA).toFixed(2),
          );
        }
        // Mesma regra por linha de GET /admin/transacoes-dom. O valor bruto é
        // fornecido pela DOM; LIQUIDEZ é a fonte canônica da parcela percentual.
        return Number(
          (amount * (1 - LIQUIDEZ) + TAXA_FIXA + TAXA_CASHBACK).toFixed(2),
        );
      };
      // A tabela mostra cada taxa em centavos. Esta soma usa o mesmo valor.
      const taxaSimInt = normalTxs.reduce(
        (s, t) => s + taxaSimIntDaTransacao(t),
        0,
      );
      // A taxa fixa da Sim Int Pay precisa ser calculada uma única vez por
      // transação. Ela alimenta tanto o card de taxas quanto o repasse, para
      // manter a identidade: repasse = faturamento − taxas Sim Int Pay.
      const taxaServicoSimIntDaTransacao = (t: (typeof normalTxs)[number]) =>
        isDeliveryAllocationSnapshot(t.financialSnapshot) ||
        t.isStandalone ||
        TAXA_SERVICO_RATE <= 0 ||
        t.createdAt == null ||
        t.createdAt < TAXA_SERVICO_DATE
          ? 0
          : TAXA_SERVICO_RATE;
      // Repasse = receita − taxa Sim Int Pay. Custos DOM (MDR, fixo e
      // cashback) são despesas da plataforma e nunca reduzem o repasse.
      const totalRepasseNormal = normalTxs.reduce(
        (s, t) =>
          s +
          (snapshotFrom(t.financialSnapshot as Prisma.JsonValue)
            ? coproductionOwnerNet(
                t.financialSnapshot,
                new Prisma.Decimal(Number(t.netAmount ?? 0)),
              ).toNumber()
            : isDeliveryAllocationSnapshot(t.financialSnapshot)
              ? Number(t.netAmount ?? 0)
              : Number(t.amount) -
                taxaSimIntDaTransacao(t) -
                taxaServicoSimIntDaTransacao(t)),
        0,
      );
      // Arredonda por transação, antes do acumulado. A tabela também mostra a
      // taxa de cada transação em centavos; arredondar apenas o total criava
      // divergência entre a soma visível (ex.: R$ 4,72) e o card (R$ 4,70).
      const taxaMDRDomNormal = normalTxs.reduce((s, t) => {
        // Relatório e tabela devem usar o mesmo snapshot persistido da venda.
        // Estimar com a taxa atual fazia o card apresentar uma MDR que não
        // existe na linha (domFee=0), especialmente em transações históricas.
        // A única exceção são cobranças Teron de workspace cujo fluxo antigo
        // não persistia snapshot algum; a tabela DOM já expõe esse MDR.
        const domFee = isTeronWorkspaceCardWithoutFeeSnapshot(t)
          ? estimateDomFeeReais({
              amountReais: Number(t.amount),
              paymentMethod: t.paymentMethod,
              installments: t.installments,
              tenantTag: tag,
            })
          : Number(t.acquirerFee ?? 0);
        return s + Number(domFee.toFixed(2));
      }, 0);
      // Cashback (R$3): a DOM NÃO cobra em maquineta (o cliente não consegue registrar os dados
      // pra receber o bônus nesse fluxo) — só entra nas transações normais.
      const custoCashback = normalTxs.reduce(
        (sum, tx) =>
          sum +
          (tx.isStandalone || isDeliveryAllocationSnapshot(tx.financialSnapshot)
            ? 0
            : TAXA_CASHBACK),
        0,
      );
      // `platformFee` é a taxa percentual Sim Int Pay persistida na venda.
      // TAXA_FIXA e TAXA_CASHBACK são custos DOM. A taxa fixa Sim Int Pay é
      // somente TAXA_SERVICO, configurável por plataforma e válida após sua
      // data de início. Somar R$1 + R$3 como receita Sim Int Pay fazia as
      // linhas e os cards divergirem — sobretudo no histórico.
      const taxaSimIntFixa = normalTxs.reduce(
        (sum, tx) => sum + taxaServicoSimIntDaTransacao(tx),
        0,
      );
      const taxaDomFixaNormal = normalTxs.reduce(
        (sum, tx) =>
          sum +
          (isDeliveryAllocationSnapshot(tx.financialSnapshot) ? 0 : TAXA_FIXA),
        0,
      );
      const totalTaxasSimIntNormal = taxaSimInt + taxaSimIntFixa;
      const taxaSimIntPctNetNormal =
        totalTaxasSimIntNormal -
        taxaMDRDomNormal -
        taxaDomFixaNormal -
        custoCashback;

      // ── Maquineta (venda física / POS) ────────────────────────────────────────────────
      // Modelo: o cliente só perde a taxa Sim Int Pay; o custo DOM sai da margem da casa.
      //   repasse            = netAmount real  (= bruto − taxa Sim Int Pay nas transações novas)
      //   taxa Sim Int Pay   = bruto − netAmount  (exatamente o que o cliente pagou)
      //   custo DOM          = tabela de custos sincronizada (canal POS)
      //   lucro Sim Int Pay  = taxa Sim Int Pay − custo DOM
      const maqBruto = maqTxs.reduce((s, t) => s + Number(t.amount), 0);
      const maqNet = maqTxs.reduce((s, t) => s + Number(t.netAmount ?? 0), 0);
      // Custo DOM da maquineta pela tabela FÍSICA, separado em % e fixo (R$1/transação),
      // para os cards de Taxas DOM. A tabela física é diferente da online (PIX 1%,
      // crédito 1x 3,49% etc.) e não cobra cashback.
      const maqDomSplit = maqTxs.reduce(
        (acc, t) => {
          const f = estimatePhysicalDomFeeReais({
            amountReais: Number(t.amount),
            paymentMethod: t.paymentMethod,
            installments: t.installments,
            tenantTag: tag,
            // No POS a DOM manda payment_method='credit_card' também no débito;
            // a bandeira é o que distingue (VISA DEBITO, ELO DEBITO, MAESTRO…).
            cardBrand: t.cardBrand,
          });
          return { pct: acc.pct + f.pct, fixa: acc.fixa + f.fixa };
        },
        { pct: 0, fixa: 0 },
      );
      const maqDom = maqDomSplit.pct + maqDomSplit.fixa;
      const totalTaxasSimIntMaq = maqBruto - maqNet;
      const totalRepasse = totalRepasseNormal + maqNet;
      // Receita e repasse precisam ter exatamente a mesma população de
      // transações. O frontend usa este valor, em vez do consolidado global,
      // para não misturar filtros/períodos de endpoints distintos.
      const receitaTotal =
        normalTxs.reduce((sum, tx) => sum + Number(tx.amount), 0) + maqBruto;

      // ── Vendas online ────────────────────────────────────────────────────────────────
      // Os cards de Taxas DOM e Taxas Sim Int Pay representam vendas online.
      // POS possui seção própria e não pode ser somado aqui: cashback e taxa
      // fixa têm regras diferentes em venda física.
      const taxaAdquirente = taxaDomFixaNormal;
      const taxaMDRDom = taxaMDRDomNormal;
      const totalTaxasDom = taxaMDRDom + taxaAdquirente + custoCashback;
      const taxaSimIntPctBruta = taxaSimInt;
      const totalTaxasSimInt = totalTaxasSimIntNormal;
      const taxaSimIntPctNet = taxaSimIntPctNetNormal;

      // Totais explícitos para visões que abrangem todos os canais. Receita
      // total − repasse total deve fechar com estes valores, não apenas com os
      // cards de vendas online.
      const taxaSimIntPctGeral = taxaSimInt + totalTaxasSimIntMaq;
      const totalTaxasSimIntGeral =
        totalTaxasSimIntNormal + totalTaxasSimIntMaq;
      const totalTaxasDomGeral = totalTaxasDom + maqDom;

      // Parcelamento não existe no app da Renovada nem no da Bosque (só à vista/PIX) —
      // cálculo desativado, cards sempre zerados no front. Código original preservado
      // comentado abaixo caso o parcelamento seja habilitado nesses apps no futuro.
      const taxaParcelamentoBruto = 0;
      const taxaParcelamentoSimIntPay = 0;
      const parcBruto = 0;
      const parcRepasse = 0;
      /*
      let taxaParcelamentoBruto = 0;
      let taxaParcelamentoSimIntPay = 0;
      // Bruto e repasse das mesmas transações, para a seção "Parcelamento" fechar a conta.
      let parcBruto = 0;
      let parcRepasse = 0;
      for (const t of normalTxs) {
        const pm = String(t.paymentMethod ?? '').toLowerCase();
        if (!pm.includes('credit')) continue;
        const inst = Math.min(Math.max(Number(t.installments ?? 1) || 1, 1), 12);
        if (inst < 2) continue;
        const amount = Number(t.amount);
        parcBruto += amount;
        {
          const netBase = Number(t.netAmount ?? amount);
          const svc = TAXA_SERVICO_RATE > 0 && t.createdAt != null && t.createdAt >= TAXA_SERVICO_DATE ? TAXA_SERVICO_RATE : 0;
          parcRepasse += netBase - svc;
        }
        const domFee = estimateDomFeeReais({ amountReais: amount, paymentMethod: t.paymentMethod, installments: inst, tenantTag: tag });
        taxaParcelamentoBruto += domFee;
      }
      */

      return {
        taxaDomPct: Math.round(taxaMDRDom * 100) / 100,
        taxaDomFixa: Math.round(taxaAdquirente * 100) / 100,
        taxaDomCashback: Math.round(custoCashback * 100) / 100,
        totalTaxasDom: Math.round(totalTaxasDom * 100) / 100,
        taxaSimIntPctBruta: Math.round(taxaSimIntPctBruta * 100) / 100,
        taxaSimIntPctNet: Math.round(taxaSimIntPctNet * 100) / 100,
        taxaSimIntFixa: Math.round(taxaSimIntFixa * 100) / 100,
        totalTaxasSimInt: Math.round(totalTaxasSimInt * 100) / 100,
        /** Taxas Sim Int Pay de online + POS; usar em totais financeiros globais. */
        taxaSimIntPctGeral: Math.round(taxaSimIntPctGeral * 100) / 100,
        totalTaxasSimIntGeral: Math.round(totalTaxasSimIntGeral * 100) / 100,
        /** Custos DOM de online + POS; não é o total da seção de vendas online. */
        totalTaxasDomGeral: Math.round(totalTaxasDomGeral * 100) / 100,
        taxaParcelamentoBruto: Math.round(taxaParcelamentoBruto * 100) / 100,
        taxaParcelamentoSimIntPay:
          Math.round(taxaParcelamentoSimIntPay * 100) / 100,
        /** Bruto das vendas no crédito (base do parcelamento). */
        parcBruto: Math.round(parcBruto * 100) / 100,
        /** Repasse ao cliente nessas mesmas vendas. */
        parcRepasse: Math.round(parcRepasse * 100) / 100,
        qtdTransacoes: qtd,
        /** Receita bruta da mesma população usada para calcular o repasse. */
        receitaTotal: Math.round(receitaTotal * 100) / 100,
        // Repasse correto (soma direta do líquido de cada tx) — o front deve usar ESTE campo.
        totalRepasse: Math.round(totalRepasse * 100) / 100,
        // ── Maquineta (venda física) — alimenta a seção "Maquinetas" do relatório ──
        // Identifica a versão do cálculo no payload para distinguir processos
        // ainda rodando código anterior após a atualização do backend.
        _v: 'dom-direct-v1',
        qtdMaquineta: maqTxs.length,
        /** Bruto que passou nas maquinetas. */
        maqBruto: Math.round(maqBruto * 100) / 100,
        /** Repasse ao cliente (netAmount real das transações de maquineta). */
        maqNet: Math.round(maqNet * 100) / 100,
        /** Custo DOM da venda física (tabela POS: MDR + R$1 em débito/crédito). */
        maqDom: Math.round(maqDom * 100) / 100,
        /** Taxa Sim Int Pay cobrada do cliente na maquineta (bruto − repasse). */
        maqSimInt: Math.round(totalTaxasSimIntMaq * 100) / 100,
      };
    };

    const localTransactions = await this.findLocalPlatformReportTransactions(
      tag,
      effectiveStart,
      endDate,
      metodoPagamento,
    );
    const txs: Parameters<typeof computeBreakdown>[0] = localTransactions.map(
      (tx) => ({
        amount: tx.amount,
        paymentMethod: tx.paymentMethod,
        installments: tx.installments,
        createdAt: tx.createdAt,
        description: tx.description,
        platformTag: tx.platformTag,
        netAmount: tx.netAmount,
        // Snapshot local imutável. A tabela de transações e os cards passam a
        // somar a mesma cópia, independente da adquirente de origem.
        acquirerFee: tx.acquirerFee,
        platformFee: tx.platformFee,
        financialSnapshot: tx.financialSnapshot,
        cardBrand: tx.cardBrand,
        acquirer: tx.acquirer,
      }),
    );

    const breakdown = computeBreakdown(txs);

    return breakdown;
  }

  async getPlatformTransactionScope(
    tag: string,
  ): Promise<Prisma.TransactionWhereInput> {
    const upperTag = normalizePlatformTag(tag);
    const platform = await this.prisma.platform.findUnique({
      where: { tag: upperTag },
      include: { owner: true },
    });
    if (
      this.expectedContext &&
      (upperTag !== this.expectedContext.tag ||
        !platform?.isActive ||
        !platform.owner?.isActive ||
        platform.owner.isPurged ||
        platform.id !== this.expectedContext.id ||
        platform.ownerUserId !== this.expectedContext.ownerUserId)
    )
      throw new ForbiddenException('Contexto da plataforma mudou');
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    return whereTransactionPlatform(upperTag);
  }

  extractOrderNumberFromText(value: string | null | undefined): string | null {
    const raw = String(value ?? '');
    const match = raw.match(/\bORD-\d{4}-\d+\b/i);
    return match ? match[0].toUpperCase() : null;
  }

  parseDomCreatedAt(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const normalized = String(raw).trim().replace(' ', 'T');
    const withTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}-03:00`;
    const date = new Date(withTimezone);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async findLocalPlatformReportTransactions(
    tag: string,
    startDate: string,
    endDate?: string,
    paymentMethod?: string,
  ) {
    const upperTag = normalizePlatformTag(tag);
    const scope = await this.getPlatformTransactionScope(upperTag);

    const createdAt: Prisma.DateTimeFilter = {
      gte: parseYmdSp(startDate).startOf('day').toDate(),
    };
    if (endDate) createdAt.lte = parseYmdSp(endDate).endOf('day').toDate();

    const and: Prisma.TransactionWhereInput[] = [];
    if (upperTag === 'RENOVADA') {
      and.push({
        OR: [
          { description: { contains: 'dizimo', mode: 'insensitive' } },
          { description: { contains: 'dízimo', mode: 'insensitive' } },
          { description: { contains: 'primicia', mode: 'insensitive' } },
          { description: { contains: 'primícia', mode: 'insensitive' } },
          { description: { contains: 'oferta', mode: 'insensitive' } },
          { description: { contains: 'maquineta', mode: 'insensitive' } },
          { description: { contains: 'terminal', mode: 'insensitive' } },
        ],
      });
    }

    return this.prisma.transaction.findMany({
      where: {
        AND: [
          scope,
          { status: 'COMPLETED' },
          { createdAt },
          ...(paymentMethod ? [{ paymentMethod: paymentMethod as any }] : []),
          ...and,
        ],
      },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        installments: true,
        description: true,
        platformTag: true,
        netAmount: true,
        acquirerFee: true,
        platformFee: true,
        financialSnapshot: true,
        cardBrand: true,
        createdAt: true,
        acquirer: true,
      },
    });
  }
}
