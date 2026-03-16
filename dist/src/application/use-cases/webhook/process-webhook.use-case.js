"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessWebhookUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const transaction_repository_interface_1 = require("../../../core/repositories/transaction.repository.interface");
const webhook_event_repository_interface_1 = require("../../../core/repositories/webhook-event.repository.interface");
const balance_log_repository_interface_1 = require("../../../core/repositories/balance-log.repository.interface");
const prisma_service_1 = require("../../../infrastructure/database/prisma/prisma.service");
let ProcessWebhookUseCase = class ProcessWebhookUseCase {
    events;
    transactions;
    balanceLogs;
    prisma;
    constructor(events, transactions, balanceLogs, prisma) {
        this.events = events;
        this.transactions = transactions;
        this.balanceLogs = balanceLogs;
        this.prisma = prisma;
    }
    getObject(v) {
        if (v && typeof v === 'object' && !Array.isArray(v))
            return v;
        return null;
    }
    getString(v) {
        if (typeof v === 'string' && v.length > 0)
            return v;
        if (typeof v === 'number' && Number.isFinite(v))
            return String(v);
        return null;
    }
    toDecimal(value) {
        if (value instanceof client_1.Prisma.Decimal)
            return value;
        if (typeof value === 'number')
            return new client_1.Prisma.Decimal(value);
        if (typeof value === 'string')
            return new client_1.Prisma.Decimal(value);
        return new client_1.Prisma.Decimal(0);
    }
    parseDomPayload(payload) {
        const root = this.getObject(payload);
        if (!root)
            return null;
        const event = this.getString(root.event);
        const signature = this.getString(root.signature);
        const data = this.getObject(root.data);
        if (!event || !signature || !data)
            return null;
        const paymentId = this.getString(data.paymentId);
        const status = this.getString(data.status);
        const amountWithoutAllFeeRaw = data.amountWithoutAllFee;
        if (!paymentId || !status)
            return null;
        const amountWithoutAllFee = typeof amountWithoutAllFeeRaw === 'number'
            ? amountWithoutAllFeeRaw
            : typeof amountWithoutAllFeeRaw === 'string'
                ? Number(amountWithoutAllFeeRaw)
                : NaN;
        if (!Number.isFinite(amountWithoutAllFee))
            return null;
        return {
            event,
            signature,
            data: {
                paymentId,
                status,
                amountWithoutAllFee,
                ...data,
            },
        };
    }
    mapDomStatusToTransactionStatus(status) {
        switch (status) {
            case 'paid':
                return client_1.TransactionStatus.COMPLETED;
            case 'refunded':
                return client_1.TransactionStatus.REFUNDED;
            case 'chargeback':
                return client_1.TransactionStatus.CHARGEBACK;
            case 'failed':
                return client_1.TransactionStatus.FAILED;
            case 'expired':
                return client_1.TransactionStatus.EXPIRED;
            case 'in_mediation':
                return client_1.TransactionStatus.IN_MEDIATION;
            case 'pending_refund':
                return client_1.TransactionStatus.PENDING_REFUND;
            default:
                return null;
        }
    }
    isValidTransition(from, to) {
        const allowed = {
            [client_1.TransactionStatus.DRAFT]: [client_1.TransactionStatus.PENDING],
            [client_1.TransactionStatus.PENDING]: [
                client_1.TransactionStatus.COMPLETED,
                client_1.TransactionStatus.FAILED,
                client_1.TransactionStatus.EXPIRED,
            ],
            [client_1.TransactionStatus.COMPLETED]: [
                client_1.TransactionStatus.REFUNDED,
                client_1.TransactionStatus.CHARGEBACK,
                client_1.TransactionStatus.IN_MEDIATION,
            ],
            [client_1.TransactionStatus.IN_MEDIATION]: [
                client_1.TransactionStatus.COMPLETED,
                client_1.TransactionStatus.REFUNDED,
            ],
            [client_1.TransactionStatus.FAILED]: [],
            [client_1.TransactionStatus.EXPIRED]: [],
            [client_1.TransactionStatus.REFUNDED]: [],
            [client_1.TransactionStatus.CHARGEBACK]: [],
            [client_1.TransactionStatus.PENDING_REFUND]: [],
        };
        return allowed[from]?.includes(to) ?? false;
    }
    async execute(input) {
        const parsed = this.parseDomPayload(input.payload);
        if (!parsed) {
            return;
        }
        const eventId = parsed.signature;
        const exists = await this.events.findByEventId(eventId);
        if (exists) {
            return;
        }
        const eventType = parsed.event;
        const event = await this.events.create({
            eventId,
            source: 'api-dom',
            eventType,
            payload: input.payload,
        });
        try {
            const domPaymentId = parsed.data.paymentId;
            const trx = await this.transactions.findByDomPaymentId(domPaymentId);
            if (!trx) {
                await this.events.markFailed(event.id, `transaction not found for domPaymentId=${domPaymentId}`);
                return;
            }
            const nextStatus = this.mapDomStatusToTransactionStatus(parsed.data.status);
            if (!nextStatus) {
                await this.events.markFailed(event.id, `unsupported status=${parsed.data.status}`);
                return;
            }
            if (!this.isValidTransition(trx.status, nextStatus)) {
                await this.events.markFailed(event.id, `invalid status transition ${trx.status} -> ${nextStatus}`);
                return;
            }
            const amountWithoutAllFee = this.toDecimal(parsed.data.amountWithoutAllFee);
            const status = parsed.data.status;
            await this.prisma.$transaction(async (p) => {
                const walletUpdates = {};
                let walletBeforeBalance = null;
                let walletBeforeLocked = null;
                let walletAfterBalance = null;
                let walletAfterLocked = null;
                const shouldMutateWallet = [
                    'paid',
                    'refunded',
                    'chargeback',
                    'in_mediation',
                ].includes(status);
                if (shouldMutateWallet) {
                    for (let attempt = 0; attempt < 3; attempt++) {
                        const wallet = await p.wallet.findUnique({
                            where: { userId: trx.userId },
                        });
                        if (!wallet)
                            throw new Error('wallet not found');
                        const balanceBefore = wallet.balance;
                        const lockedBefore = wallet.lockedBalance;
                        walletBeforeBalance ??= balanceBefore;
                        walletBeforeLocked ??= lockedBefore;
                        let balanceAfter = balanceBefore;
                        let lockedAfter = lockedBefore;
                        if (status === 'paid') {
                            balanceAfter = balanceBefore.add(amountWithoutAllFee);
                        }
                        else if (status === 'refunded' || status === 'chargeback') {
                            balanceAfter = balanceBefore.sub(amountWithoutAllFee);
                        }
                        else if (status === 'in_mediation') {
                            balanceAfter = balanceBefore.sub(amountWithoutAllFee);
                            lockedAfter = lockedBefore.add(amountWithoutAllFee);
                        }
                        walletUpdates.balance = balanceAfter;
                        walletUpdates.lockedBalance = lockedAfter;
                        const result = await p.wallet.updateMany({
                            where: { id: wallet.id, version: wallet.version },
                            data: {
                                balance: balanceAfter,
                                lockedBalance: lockedAfter,
                                version: { increment: 1 },
                            },
                        });
                        if (result.count > 0) {
                            walletAfterBalance = balanceAfter;
                            walletAfterLocked = lockedAfter;
                            break;
                        }
                        if (attempt === 2) {
                            throw new Error('Wallet version conflict after 3 retries');
                        }
                    }
                }
                await p.transaction.update({
                    where: { id: trx.id },
                    data: { previousStatus: trx.status, status: nextStatus },
                });
                await p.transactionStatusHistory.create({
                    data: {
                        transactionId: trx.id,
                        fromStatus: trx.status,
                        toStatus: nextStatus,
                        metadata: { reason: `webhook: ${eventType}` },
                    },
                });
                if (shouldMutateWallet &&
                    walletBeforeBalance &&
                    walletBeforeLocked &&
                    walletAfterBalance &&
                    walletAfterLocked) {
                    await p.balanceLog.create({
                        data: {
                            userId: trx.userId,
                            action: `WEBHOOK_${eventType}`,
                            transactionId: trx.id,
                            amount: amountWithoutAllFee,
                            balanceBefore: walletBeforeBalance,
                            balanceAfter: walletAfterBalance,
                            lockedBefore: walletBeforeLocked,
                            lockedAfter: walletAfterLocked,
                            source: 'WEBHOOK',
                            metadata: input.payload,
                        },
                    });
                }
            });
            await this.events.markProcessed(event.id);
        }
        catch (e) {
            await this.events.markFailed(event.id, e instanceof Error ? e.message : 'unknown error');
        }
    }
};
exports.ProcessWebhookUseCase = ProcessWebhookUseCase;
exports.ProcessWebhookUseCase = ProcessWebhookUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(webhook_event_repository_interface_1.WEBHOOK_EVENT_REPOSITORY)),
    __param(1, (0, common_1.Inject)(transaction_repository_interface_1.TRANSACTION_REPOSITORY)),
    __param(2, (0, common_1.Inject)(balance_log_repository_interface_1.BALANCE_LOG_REPOSITORY)),
    __metadata("design:paramtypes", [Object, Object, Object, prisma_service_1.PrismaService])
], ProcessWebhookUseCase);
//# sourceMappingURL=process-webhook.use-case.js.map