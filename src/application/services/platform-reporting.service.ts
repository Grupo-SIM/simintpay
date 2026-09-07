import { Injectable } from '@nestjs/common';
import {
  BillingContractStatus,
  Prisma,
  type PaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const ACTIVE_ORDER_STATUSES = [
  'active',
  'completed',
  'approved',
  'paid',
  'success',
  'trial',
];

type ReportCustomer = {
  aliases: string[];
  name: string;
  email: string;
  cpf: string;
  createdAt: Date;
  status: string;
  active: boolean;
  isRegisteredInSimIntPay: boolean;
};

export type PlatformCustomerRow = Omit<ReportCustomer, 'aliases' | 'active'> & {
  balance: number;
  lockedBalance: number;
};

type PaymentFact = {
  paymentMethod: PaymentMethod | string | null;
  amount: number;
};

@Injectable()
export class PlatformReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async getCommunityCustomerStats(platformTag: string, communityId: string) {
    const customers = await this.loadCommunityCustomers(platformTag, communityId);
    return {
      totalContas: customers.length,
      sellersAtivos: customers.filter((customer) => customer.active).length,
    };
  }

  async listCommunityCustomers(
    platformTag: string,
    communityId: string,
    options: { page: number; pageSize: number; onlyActive: boolean },
  ) {
    const customers = (await this.loadCommunityCustomers(platformTag, communityId))
      .filter((customer) => !options.onlyActive || customer.active)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const skip = (options.page - 1) * options.pageSize;
    const paged = customers.slice(skip, skip + options.pageSize);
    const emails = paged.map((customer) => customer.email).filter(Boolean);
    const registeredUsers = emails.length
      ? await this.prisma.user.findMany({
          where: { email: { in: emails } },
          select: { email: true },
        })
      : [];
    const registeredEmails = new Set(
      registeredUsers.map((user) => user.email.toLowerCase()),
    );

    return {
      data: paged.map(({ aliases: _aliases, active: _active, ...customer }) => ({
        ...customer,
        balance: 0,
        lockedBalance: 0,
        isRegisteredInSimIntPay:
          customer.isRegisteredInSimIntPay ||
          registeredEmails.has(customer.email.toLowerCase()),
      })),
      total: customers.length,
      page: options.page,
      pageSize: options.pageSize,
    };
  }

  async getCommunityPaymentDistribution(
    platformTag: string,
    communityId: string,
    range: { start?: Date; end?: Date },
  ) {
    const facts = await this.loadCommunityPaymentFacts(
      platformTag,
      communityId,
      range,
    );
    const grouped = new Map<string, { count: number; total: number }>();
    for (const fact of facts) {
      const method = String(fact.paymentMethod ?? 'UNKNOWN').toUpperCase();
      const bucket =
        method === 'PIX'
          ? 'PIX'
          : method === 'DEBIT_CARD'
            ? 'DEBIT_CARD'
            : 'CREDIT_CARD';
      const current = grouped.get(bucket) ?? { count: 0, total: 0 };
      grouped.set(bucket, {
        count: current.count + 1,
        total: current.total + fact.amount,
      });
    }

    const labels: Record<string, string> = {
      PIX: 'Pix',
      CREDIT_CARD: 'Crédito',
      DEBIT_CARD: 'Débito',
    };
    return {
      total: facts.length,
      items: ['PIX', 'CREDIT_CARD', 'DEBIT_CARD']
        .map((codigo) => {
          const entry = grouped.get(codigo) ?? { count: 0, total: 0 };
          return {
            codigo,
            nome: labels[codigo],
            quantidade: entry.count,
            valor: Number(entry.total.toFixed(2)),
            percentual:
              facts.length > 0
                ? Number(((entry.count / facts.length) * 100).toFixed(2))
                : 0,
          };
        })
        .filter((row) => row.quantidade > 0)
        .sort((a, b) => b.quantidade - a.quantidade),
    };
  }

  private async loadCommunityCustomers(
    platformTag: string,
    communityId: string,
  ): Promise<ReportCustomer[]> {
    const upperTag = platformTag.toUpperCase();
    const bindings = await this.prisma.communityLinkBinding.findMany({
      where: { communityId, subscriptionLinkId: { not: null } },
      select: { subscriptionLinkId: true },
      distinct: ['subscriptionLinkId'],
    });
    const linkIds = bindings
      .map((binding) => binding.subscriptionLinkId)
      .filter((id): id is string => Boolean(id));
    const [orders, contracts] = await Promise.all([
      this.prisma.subscriptionLinkOrder.findMany({
        where: { subscriptionLinkId: { in: linkIds.length ? linkIds : ['__none__'] } },
        select: {
          id: true,
          customerName: true,
          customerEmail: true,
          customerDocument: true,
          createdAt: true,
          status: true,
        },
      }),
      this.prisma.billingContract.findMany({
        where: { metadata: { path: ['platformTag'], equals: upperTag } },
        select: {
          id: true,
          externalSubscriptionId: true,
          metadata: true,
          status: true,
          graceEndsAt: true,
          accessEndsAt: true,
          createdAt: true,
        },
      }),
    ]);
    const subscriptionIds = contracts.map(
      (contract) => contract.externalSubscriptionId,
    );
    const transactions = subscriptionIds.length
      ? await this.prisma.transaction.findMany({
          where: { externalPaymentId: { in: subscriptionIds } },
          select: {
            externalPaymentId: true,
            customerName: true,
            customerEmail: true,
            customerDocument: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const transactionBySubscription = new Map(
      transactions.map((transaction) => [
        transaction.externalPaymentId,
        transaction,
      ]),
    );
    const customers = new Map<string, ReportCustomer>();
    const aliases = new Map<string, string>();

    const upsert = (candidate: ReportCustomer) => {
      const existingKey = candidate.aliases
        .map((alias) => aliases.get(alias))
        .find(Boolean);
      const key = existingKey ?? candidate.aliases[0];
      const existing = customers.get(key);
      if (existing) {
        existing.active ||= candidate.active;
        existing.isRegisteredInSimIntPay ||= candidate.isRegisteredInSimIntPay;
        existing.createdAt =
          existing.createdAt < candidate.createdAt
            ? existing.createdAt
            : candidate.createdAt;
        if (!existing.name) existing.name = candidate.name;
        if (!existing.email) existing.email = candidate.email;
        if (!existing.cpf) existing.cpf = candidate.cpf;
        if (candidate.active) existing.status = candidate.status;
        existing.aliases = [...new Set([...existing.aliases, ...candidate.aliases])];
        for (const alias of existing.aliases) aliases.set(alias, key);
        return;
      }
      customers.set(key, candidate);
      for (const alias of candidate.aliases) aliases.set(alias, key);
    };

    for (const order of orders) {
      const identityAliases = this.customerIdentityAliases(
        order.customerDocument,
        order.customerEmail,
      );
      upsert({
        aliases: identityAliases.length ? identityAliases : [`order:${order.id}`],
        name: order.customerName,
        email: order.customerEmail,
        cpf: order.customerDocument,
        createdAt: order.createdAt,
        status: order.status,
        active: ACTIVE_ORDER_STATUSES.includes(order.status.toLowerCase()),
        isRegisteredInSimIntPay: false,
      });
    }

    const now = new Date();
    for (const contract of contracts) {
      const metadata = this.jsonObject(contract.metadata);
      const transaction = transactionBySubscription.get(
        contract.externalSubscriptionId,
      );
      const reportingCustomerId =
        this.nonEmptyString(metadata?.reportingCustomerId) ??
        this.nonEmptyString(metadata?.teronAccountId);
      const identityAliases = this.customerIdentityAliases(
        transaction?.customerDocument,
        transaction?.customerEmail,
      );
      upsert({
        aliases: [
          ...(reportingCustomerId
            ? [`customer:${reportingCustomerId}`]
            : []),
          ...identityAliases,
          `contract:${contract.id}`,
        ],
        name: transaction?.customerName ?? '',
        email: transaction?.customerEmail ?? '',
        cpf: transaction?.customerDocument ?? '',
        createdAt: contract.createdAt,
        status: contract.status,
        active: this.contractHasAccess(contract, now),
        isRegisteredInSimIntPay: true,
      });
    }

    return [...customers.values()];
  }

  private async loadCommunityPaymentFacts(
    platformTag: string,
    communityId: string,
    range: { start?: Date; end?: Date },
  ): Promise<PaymentFact[]> {
    const upperTag = platformTag.toUpperCase();
    const bindings = await this.prisma.communityLinkBinding.findMany({
      where: { communityId, subscriptionLinkId: { not: null } },
      select: { subscriptionLinkId: true },
      distinct: ['subscriptionLinkId'],
    });
    const linkIds = bindings
      .map((binding) => binding.subscriptionLinkId)
      .filter((id): id is string => Boolean(id));
    const createdAt: Prisma.DateTimeFilter = {};
    if (range.start) createdAt.gte = range.start;
    if (range.end) createdAt.lte = range.end;
    const hasDateFilter = Object.keys(createdAt).length > 0;
    const [orders, transactions] = await Promise.all([
      this.prisma.subscriptionLinkOrder.findMany({
        where: {
          subscriptionLinkId: { in: linkIds.length ? linkIds : ['__none__'] },
          status: 'paid',
          ...(hasDateFilter ? { createdAt } : {}),
        },
        select: { id: true, paymentMethod: true, amountCharged: true },
      }),
      this.prisma.transaction.findMany({
        where: {
          description: {
            contains: `[TENANT:${upperTag}]`,
            mode: 'insensitive',
          },
          status: 'COMPLETED',
          ...(hasDateFilter ? { createdAt } : {}),
        },
        select: { description: true, paymentMethod: true, amount: true },
      }),
    ]);
    const representedOrders = new Set<string>();
    for (const transaction of transactions) {
      const match = transaction.description?.match(/subOrder=([^\s\]]+)/i);
      if (match) representedOrders.add(match[1]);
    }
    return [
      ...orders
        .filter((order) => !representedOrders.has(order.id))
        .map((order) => ({
          paymentMethod: order.paymentMethod,
          amount: Number(order.amountCharged),
        })),
      ...transactions.map((transaction) => ({
        paymentMethod: transaction.paymentMethod,
        amount: Number(transaction.amount),
      })),
    ];
  }

  private contractHasAccess(
    contract: {
      status: BillingContractStatus;
      graceEndsAt: Date | null;
      accessEndsAt: Date | null;
    },
    now: Date,
  ): boolean {
    if (contract.status === BillingContractStatus.ACTIVE) return true;
    if (contract.status === BillingContractStatus.PAST_DUE) {
      return Boolean(contract.graceEndsAt && contract.graceEndsAt > now);
    }
    if (contract.status === BillingContractStatus.CANCELLED) {
      return Boolean(contract.accessEndsAt && contract.accessEndsAt > now);
    }
    return false;
  }

  private customerIdentityAliases(
    document: string | null | undefined,
    email: string | null | undefined,
  ): string[] {
    const digits = String(document ?? '').replace(/\D/g, '');
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    return [
      ...(digits ? [`document:${digits}`] : []),
      ...(normalizedEmail ? [`email:${normalizedEmail}`] : []),
    ];
  }

  private jsonObject(value: Prisma.JsonValue | null) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : null;
  }

  private nonEmptyString(value: Prisma.JsonValue | undefined) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
