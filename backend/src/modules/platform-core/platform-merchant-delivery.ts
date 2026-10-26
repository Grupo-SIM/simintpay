import type { WithdrawStatus } from '@prisma/client';

export function merchantWithdrawalDelivery(merchantId: string, withdrawal: { id: string; status: WithdrawStatus; integrationRequestId: string | null; rejectionReason: string | null; updatedAt: Date }) {
  return { merchantId, payload: { eventId: `${withdrawal.id}:${withdrawal.status}`, requestId: withdrawal.integrationRequestId,
    rejectionReason: withdrawal.rejectionReason, status: withdrawal.status, updatedAt: withdrawal.updatedAt.toISOString(), withdrawalId: withdrawal.id },
    status: withdrawal.status, withdrawalId: withdrawal.id };
}
