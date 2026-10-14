import { PlatformFinanceService } from './platform-finance.service';
import { Injectable } from '@nestjs/common';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

const AREAFLIX_CLAIM_TRANSFER_ACTION = 'AREAFLIX_CLAIM_TRANSFER';

const areaflixWithdrawMin = () => getPlatformTaxaEffective('AREAFLIX', 'SAQUE_MIN', 100);
const areaflixWithdrawFee = () => getPlatformTaxaEffective('AREAFLIX', 'TAXA_SAQUE_FIXA', 2);

@Injectable()
export class InternalAreaflixFinanceService {
  constructor(private readonly prisma: PrismaService, private readonly finance: PlatformFinanceService) {}


  private normalizeDoc(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private resolveUserIdsByDoc(doc: string): Promise<string[]> {
    return this.finance.resolveAccountIds({ document: doc, activeOnly: true });
  }
  async wallet( cpf: string, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { accountExists: false, balance: 0, lockedBalance: 0, availableBalance: 0 };
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: userIds[0] },
    });

    const balance = Number(wallet?.balance ?? 0);
    const locked = Number(wallet?.lockedBalance ?? 0);

    return {
      accountExists: true,
      balance: Number(balance.toFixed(2)),
      lockedBalance: Number(locked.toFixed(2)),
      availableBalance: Number(Math.max(0, balance - locked).toFixed(2)),
    };
  }
  async accountStatus( cpf: string, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByDoc(cpf);
    return {
      accountExists: userIds.length > 0,
      minimumWithdrawalAmount: areaflixWithdrawMin(),
      withdrawalFeeBrl: areaflixWithdrawFee(),
    };
  }
  async withdrawals( cpf: string, page = '1', limit = '20', internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { withdrawals: [], meta: { currentPage: 1, itemsPerPage: 20, totalItems: 0, totalPages: 1 } };
    }
    const pageNum = Math.max(1, Number(page || 1));
    const size = Math.min(Math.max(1, Number(limit || 20)), 200);

    const where = { userId: { in: userIds }, platform: 'areaflix' };

    const [totalItems, items] = await Promise.all([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
    ]);

    return {
      withdrawals: items.map((w) => ({
        id: w.id,
        amount: Number(w.amount),
        grossAmount: Number(w.grossAmount),
        fee: Number(w.fee),
        status: w.status,
        pixKey: w.pixKey,
        rejectionReason: w.rejectionReason ?? null,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
      meta: {
        currentPage: pageNum,
        itemsPerPage: size,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / size)),
      },
    };
  }
  async withdrawalTotals( cpf: string, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByDoc(cpf);
    if (userIds.length === 0) {
      return { pendingGross: 0, completedGross: 0 };
    }

    const [pending, completed] = await Promise.all([
      this.prisma.withdrawRequest.aggregate({
        where: { userId: { in: userIds }, platform: 'areaflix', status: 'PENDING' },
        _sum: { grossAmount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId: { in: userIds }, platform: 'areaflix', status: { in: ['APPROVED', 'COMPLETED'] } },
        _sum: { grossAmount: true },
      }),
    ]);

    return {
      pendingGross: Number(pending._sum.grossAmount ?? 0),
      completedGross: Number(completed._sum.grossAmount ?? 0),
    };
  }
  async claimLinks(
    body: {
      cpf: string;
      paymentLinkIds?: string[];
      subscriptionLinkIds?: string[];
      /** Saldo líquido acumulado antes do vínculo — transferido da conta de serviço para o admin (uma única vez). */
      retroactiveAmount?: number;
      /** Email da conta de serviço da areaflix (dona original dos links/saldo). */
      serviceAccountEmail?: string;
      /** Nome do admin areaflix — exibido na tela de donos por CPF (Leads). */
      adminName?: string;
    }, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByDoc(body.cpf);
    const targetUserId = userIds[0] ?? null;

    // Registrar o dono na tela de "Leads" (donos por CPF/plataforma) — vinculado
    // quando a conta simpay existe, sem vínculo caso contrário.
    await this.upsertAreaflixOwner(body.cpf, body.adminName ?? null, targetUserId);

    if (!targetUserId) {
      return { claimed: false, reason: 'Nenhuma conta simpay para este CPF/CNPJ' };
    }

    const paymentLinkIds = (body.paymentLinkIds ?? []).filter(Boolean);
    const subscriptionLinkIds = (body.subscriptionLinkIds ?? []).filter(Boolean);

    let paymentLinks = 0;
    let subscriptionLinks = 0;
    let orders = 0;
    let transactions = 0;

    if (paymentLinkIds.length > 0) {
      const result = await this.prisma.paymentLink.updateMany({
        where: { id: { in: paymentLinkIds }, userId: { not: targetUserId } },
        data: { userId: targetUserId },
      });
      paymentLinks = result.count;

      // Transações passadas dos links avulsos → aparecem na conta do admin
      const txResult = await this.prisma.transaction.updateMany({
        where: { paymentLinkId: { in: paymentLinkIds }, userId: { not: targetUserId } },
        data: { userId: targetUserId },
      });
      transactions += txResult.count;
    }

    if (subscriptionLinkIds.length > 0) {
      const result = await this.prisma.subscriptionLink.updateMany({
        where: { id: { in: subscriptionLinkIds }, userId: { not: targetUserId } },
        data: { userId: targetUserId },
      });
      subscriptionLinks = result.count;

      // Ordens existentes também — renovações futuras creditam o novo dono
      const linkOrders = await this.prisma.subscriptionLinkOrder.findMany({
        where: { subscriptionLinkId: { in: subscriptionLinkIds } },
        select: { id: true, domPixPaymentId: true },
      });
      const ordersResult = await this.prisma.subscriptionLinkOrder.updateMany({
        where: {
          subscriptionLinkId: { in: subscriptionLinkIds },
          userId: { not: targetUserId },
        },
        data: { userId: targetUserId },
      });
      orders = ordersResult.count;

      // Transações passadas das assinaturas (ativação PIX e renovações registradas
      // com AREAFLIX_SL_{orderId}) → aparecem na conta do admin
      const payIds = [
        ...linkOrders.map((o) => o.domPixPaymentId).filter((v): v is string => Boolean(v)),
        ...linkOrders.map((o) => `AREAFLIX_SL_${o.id}`),
      ];
      if (payIds.length > 0) {
        const txResult = await this.prisma.transaction.updateMany({
          where: { domPaymentId: { in: payIds }, userId: { not: targetUserId } },
          data: { userId: targetUserId },
        });
        transactions += txResult.count;
      }
    }

    // Transferência retroativa do saldo (uma única vez por admin):
    // move o líquido acumulado pré-vínculo da carteira da conta de serviço
    // para a carteira do admin, igualando o saldo simpay ao saldo areaflix.
    let retroactiveTransferred = 0;
    const retroactive = Number(body.retroactiveAmount ?? 0);
    if (retroactive > 0 && body.serviceAccountEmail?.trim()) {
      const alreadyTransferred = await this.prisma.balanceLog.findFirst({
        where: { userId: targetUserId, action: AREAFLIX_CLAIM_TRANSFER_ACTION },
        select: { id: true },
      });

      const serviceUser = await this.prisma.user.findUnique({
        where: { email: body.serviceAccountEmail.trim() },
        include: { wallet: true },
      });

      const serviceWallet = serviceUser?.wallet ?? null;
      if (!alreadyTransferred && serviceUser && serviceWallet) {
        const amountDec = new Prisma.Decimal(retroactive.toFixed(2));

        await this.prisma.$transaction(async (tx) => {
          const targetWallet = await tx.wallet.upsert({
            where: { userId: targetUserId },
            update: {},
            create: { userId: targetUserId, balance: 0, lockedBalance: 0 },
          });

          const serviceBefore = serviceWallet.balance;
          const targetBefore = targetWallet.balance;

          await tx.wallet.update({
            where: { userId: serviceUser.id },
            data: { balance: { decrement: amountDec }, version: { increment: 1 } },
          });
          await tx.wallet.update({
            where: { userId: targetUserId },
            data: { balance: { increment: amountDec }, version: { increment: 1 } },
          });

          await tx.balanceLog.create({
            data: {
              userId: targetUserId,
              action: AREAFLIX_CLAIM_TRANSFER_ACTION,
              amount: amountDec,
              balanceBefore: targetBefore,
              balanceAfter: new Prisma.Decimal(Number(targetBefore) + retroactive),
              lockedBefore: targetWallet.lockedBalance,
              lockedAfter: targetWallet.lockedBalance,
              source: 'AREAFLIX',
              description: `Vínculo areaflix: saldo retroativo transferido da conta de serviço (${body.serviceAccountEmail})`,
            },
          });
          await tx.balanceLog.create({
            data: {
              userId: serviceUser.id,
              action: AREAFLIX_CLAIM_TRANSFER_ACTION,
              amount: amountDec.neg(),
              balanceBefore: serviceBefore,
              balanceAfter: new Prisma.Decimal(Number(serviceBefore) - retroactive),
              lockedBefore: serviceWallet.lockedBalance,
              lockedAfter: serviceWallet.lockedBalance,
              source: 'AREAFLIX',
              description: `Vínculo areaflix: saldo retroativo transferido para o admin (doc ${this.normalizeDoc(body.cpf)})`,
            },
          });
        });

        retroactiveTransferred = retroactive;
      }
    }

    return {
      claimed: true,
      targetUserId,
      transferred: { paymentLinks, subscriptionLinks, orders, transactions },
      retroactiveTransferred,
    };
  }

  /**
   * Mantém o registro do dono areaflix na tela de donos por CPF ("Leads"):
   * cria/atualiza ExternalPlatformUser (platform areaflix), vinculando ao User
   * simpay quando a conta existe.
   */
  private async upsertAreaflixOwner(
    doc: string,
    name: string | null,
    targetUserId: string | null,
  ): Promise<void> {
    const clean = this.normalizeDoc(doc);
    if (clean.length !== 11 && clean.length !== 14) return;

    try {
      if (!targetUserId) return;
      const platform = await this.prisma.platform.findFirst({
        where: { tag: { equals: 'areaflix', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false }, ownerUserId: targetUserId },
      });
      if (!platform) return;

      const where =
        clean.length === 11
          ? { platform: 'areaflix', cpf: clean }
          : { platform: 'areaflix', cnpj: clean };

      const existing = await this.prisma.externalPlatformUser.findFirst({ where });

      if (existing) {
        await this.prisma.externalPlatformUser.update({
          where: { id: existing.id },
          data: {
            name: name ?? existing.name,
            userId: targetUserId ?? existing.userId,
            isDeleted: false,
            deletedAt: null,
          },
        });
      } else {
        await this.prisma.externalPlatformUser.create({
          data: {
            ...(clean.length === 11 ? { cpf: clean } : { cnpj: clean }),
            name: name ?? 'Admin Areaflix',
            platform: 'areaflix',
            userId: targetUserId,
          },
        });
      }
    } catch {
      // registro na tela de donos é cosmético — não pode quebrar o claim
    }
  }
  async requestWithdraw( body: { cpf: string; amount: number; pixKey: string }, internalToken?: string,
  ) {
    const userIds = await this.resolveUserIdsByDoc(body.cpf);
    if (userIds.length === 0) {
      throw new BadRequestException('Nenhuma conta simintpay encontrada para este CPF/CNPJ');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor inválido');
    if (amount < areaflixWithdrawMin()) {
      throw new BadRequestException(`Valor mínimo para saque é de R$ ${areaflixWithdrawMin().toFixed(2)}`);
    }
    if (!body.pixKey?.trim()) throw new BadRequestException('Chave PIX é obrigatória');

    // Apenas um saque pendente por vez
    const active = await this.prisma.withdrawRequest.findFirst({
      where: { userId: { in: userIds }, platform: 'areaflix', status: 'PENDING' },
    });
    if (active) {
      throw new BadRequestException('Já existe uma solicitação de saque em andamento. Aguarde a conclusão.');
    }

    const targetUserId = userIds[0];
    const grossAmount = parseFloat(amount.toFixed(2));
    const netAmount = parseFloat((amount - areaflixWithdrawFee()).toFixed(2));
    if (netAmount <= 0) {
      throw new BadRequestException(
        `Valor insuficiente para cobrir a taxa de saque (R$ ${areaflixWithdrawFee().toFixed(2)})`,
      );
    }

    // Valida saldo disponível e trava o bruto na carteira (padrão do fluxo de saque:
    // aprovação debita, recusa destrava)
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: targetUserId } });
    const available = Number(wallet?.balance ?? 0) - Number(wallet?.lockedBalance ?? 0);
    if (!wallet || grossAmount > available) {
      throw new BadRequestException(
        `Saldo insuficiente na carteira simintpay. Disponível: R$ ${Math.max(0, available).toFixed(2)}`,
      );
    }

    const grossDec = new Prisma.Decimal(grossAmount.toFixed(2));

    const created = await this.finance.createWithdrawal({ userId: targetUserId, amount: netAmount, grossAmount, fee: parseFloat(areaflixWithdrawFee().toFixed(2)), pixKey: body.pixKey.trim(), platform: 'areaflix', reserveWallet: true, logBalance: true });

    return { success: true, id: created.id };
  }
}
